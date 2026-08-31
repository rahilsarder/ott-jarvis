import { prisma } from './prisma';
import { generateApiKey, hashOpaqueToken } from './crypto';

export interface CreatedApiKey {
  id: string;
  label: string;
  key: string;
}

export interface ApiKeyRecord {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  contentItemCount: number;
}

export async function createApiKey(label: string): Promise<CreatedApiKey> {
  const key = generateApiKey();
  const row = await prisma.jarvisApiKey.create({ data: { label, keyHash: hashOpaqueToken(key) } });
  return { id: row.id, label: row.label, key };
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const keys = await prisma.jarvisApiKey.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  if (keys.length === 0) return [];

  // ContentItem.submittedByApiKeyId is a loose id, not a Prisma relation, so this is a
  // separate aggregate query rather than a nested _count — cheap (one query, grouped) and
  // is the "is this FTP source actually sending anything" signal an operator wants to see.
  const counts = await prisma.contentItem.groupBy({
    by: ['submittedByApiKeyId'],
    where: { submittedByApiKeyId: { in: keys.map((k) => k.id) } },
    _count: { _all: true },
  });
  const countByKeyId = new Map(counts.map((c) => [c.submittedByApiKeyId, c._count._all]));

  return keys.map((k) => ({ ...k, contentItemCount: countByKeyId.get(k.id) ?? 0 }));
}

export async function revokeApiKey(id: string): Promise<void> {
  await prisma.jarvisApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function verifyApiKey(raw: string): Promise<{ id: string } | null> {
  const row = await prisma.jarvisApiKey.findFirst({
    where: { keyHash: hashOpaqueToken(raw), revokedAt: null },
    select: { id: true },
  });
  if (!row) return null;
  await prisma.jarvisApiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { id: row.id };
}
