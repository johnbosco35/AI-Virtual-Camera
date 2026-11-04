export interface ChainTransfer {
  contractAddress: string; // base58
  from: string;
  to: string;
  amountBaseUnits: string;
}

export type TxLookup =
  | { state: 'not_found' }
  | { state: 'failed'; reason: string }
  | {
      state: 'unconfirmed' | 'confirmed'; // confirmed = solidified (irreversible)
      txHash: string;
      blockTimestampMs: number;
      blockNumber?: number;
      transfers: ChainTransfer[];
    };

export interface IncomingTransfer {
  txHash: string;
  amountBaseUnits: string;
  blockTimestampMs: number;
}

/** Everything the payment service knows about the blockchain goes through this interface. */
export interface TronProvider {
  readonly name: string;
  getTransaction(txHash: string): Promise<TxLookup>;
  listIncomingTransfers(args: { toAddress: string; contractAddress: string; sinceMs: number }): Promise<IncomingTransfer[]>;
}
