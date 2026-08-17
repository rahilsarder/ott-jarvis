import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { revokeApiKey } from '@/lib/api-key.service';

async function requireSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

// Soft delete, like DELETE /api/deployments/[id]: revokeApiKey stamps revokedAt, so verifyApiKey
// stops accepting the key while the row stays for audit.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await revokeApiKey(id);
  return new NextResponse(null, { status: 204 });
}
