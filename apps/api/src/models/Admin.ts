import { Schema, model, type InferSchemaType } from 'mongoose';

export const PERMISSIONS = [
  'products:read', 'products:write',
  'orders:read',
  'payments:read', 'payments:reconcile', 'payments:manual',
  'entitlements:read', 'entitlements:revoke', 'entitlements:recover',
  'activations:read',
  'sessions:read', 'sessions:terminate',
  'releases:read', 'releases:write',
  'audit:read', 'stats:read',
  'admins:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = [
  'products:read', 'orders:read', 'payments:read', 'entitlements:read', 'activations:read',
  'sessions:read', 'releases:read', 'audit:read', 'stats:read',
];

export const ROLE_DEFAULTS: Record<'superadmin' | 'operator' | 'support', readonly Permission[]> = {
  superadmin: PERMISSIONS,
  operator: [...READ_ONLY, 'products:write', 'payments:reconcile', 'releases:write', 'sessions:terminate'],
  support: READ_ONLY,
};

const adminSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['superadmin', 'operator', 'support'], required: true },
    extraPermissions: [{ type: String, enum: PERMISSIONS }],
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    lastLoginAt: Date,
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: Date,
  },
  { timestamps: true },
);
adminSchema.index({ email: 1 }, { unique: true });

export type AdminDoc = InferSchemaType<typeof adminSchema> & { _id: import('mongoose').Types.ObjectId };
export const Admin = model('Admin', adminSchema);

export function effectivePermissions(a: { role: keyof typeof ROLE_DEFAULTS; extraPermissions?: string[] }): Set<string> {
  return new Set<string>([...ROLE_DEFAULTS[a.role], ...(a.extraPermissions ?? [])]);
}
