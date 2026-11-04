import { randomBytes } from 'node:crypto';

/** Unguessable 128-bit public identifiers, e.g. ord_3kQ... */
export const newId = (prefix: string): string => `${prefix}_${randomBytes(16).toString('base64url')}`;
