import { normalizeTronAddress } from '../../utils/tronAddress';
import { fetchJson } from './http';
import type { ChainTransfer, IncomingTransfer, TronProvider, TxLookup } from './types';

interface TxInfo {
  id?: string;
  blockNumber?: number;
  blockTimeStamp?: number;
  result?: string;
  receipt?: { result?: string };
}
interface EventsResponse {
  data?: Array<{
    contract_address: string;
    event_name: string;
    result?: { from?: string; to?: string; value?: string };
  }>;
}
interface Trc20Response {
  data?: Array<{
    transaction_id: string;
    block_timestamp: number;
    value: string;
    type?: string;
    token_info?: { address?: string };
  }>;
}

export class TronGridProvider implements TronProvider {
  readonly name = 'trongrid';

  constructor(private readonly baseUrl: string, private readonly apiKey?: string) {}

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : {}) };
  }

  private post<T>(path: string, body: unknown) {
    return fetchJson<T>(`${this.baseUrl}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
  }

  async getTransaction(txHash: string): Promise<TxLookup> {
    // Solidity node only answers for irreversible (solidified) transactions.
    const solid = await this.post<TxInfo>('/walletsolidity/gettransactioninfobyid', { value: txHash });
    const confirmed = Boolean(solid.id);
    const info = confirmed ? solid : await this.post<TxInfo>('/wallet/gettransactioninfobyid', { value: txHash });
    if (!info.id) return { state: 'not_found' };

    if (info.result === 'FAILED' || (info.receipt?.result && info.receipt.result !== 'SUCCESS')) {
      return { state: 'failed', reason: 'Transaction failed on chain.' };
    }

    const events = await fetchJson<EventsResponse>(`${this.baseUrl}/v1/transactions/${txHash}/events`, {
      headers: this.headers(),
    });
    const transfers: ChainTransfer[] = [];
    for (const e of events.data ?? []) {
      if (e.event_name !== 'Transfer' || !e.result?.from || !e.result.to || e.result.value === undefined) continue;
      try {
        transfers.push({
          contractAddress: normalizeTronAddress(e.contract_address),
          from: normalizeTronAddress(e.result.from),
          to: normalizeTronAddress(e.result.to),
          amountBaseUnits: BigInt(e.result.value).toString(),
        });
      } catch {
        // Skip malformed events instead of trusting them.
      }
    }
    return {
      state: confirmed ? 'confirmed' : 'unconfirmed',
      txHash,
      blockTimestampMs: info.blockTimeStamp ?? 0,
      blockNumber: info.blockNumber,
      transfers,
    };
  }

  async listIncomingTransfers(args: { toAddress: string; contractAddress: string; sinceMs: number }): Promise<IncomingTransfer[]> {
    const qs = new URLSearchParams({
      only_confirmed: 'true',
      only_to: 'true',
      contract_address: args.contractAddress,
      min_timestamp: String(args.sinceMs),
      limit: '200',
    });
    const res = await fetchJson<Trc20Response>(`${this.baseUrl}/v1/accounts/${args.toAddress}/transactions/trc20?${qs}`, {
      headers: this.headers(),
    });
    return (res.data ?? [])
      .filter((t) => (t.type ?? 'Transfer') === 'Transfer')
      .map((t) => ({
        txHash: t.transaction_id.toLowerCase(),
        amountBaseUnits: BigInt(t.value).toString(),
        blockTimestampMs: t.block_timestamp,
      }));
  }
}
