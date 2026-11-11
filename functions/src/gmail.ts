import { htmlToText } from './classify';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailMessage {
  id: string;
  internalDate: number; // ms
  from: string;
  subject: string;
  messageIdHeader: string;
  body: string; // plain text, truncated
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gmail API ${res.status}: ${text.slice(0, 200)}`);
    (err as any).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export async function listMessageIds(token: string, q: string, pageToken?: string, max = 50): Promise<{ ids: string[]; next?: string }> {
  const params = new URLSearchParams({ q, maxResults: String(max) });
  if (pageToken) params.set('pageToken', pageToken);
  const r = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `/messages?${params}`);
  return { ids: (r.messages ?? []).map(m => m.id), next: r.nextPageToken };
}

interface Part {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: Part[];
  headers?: { name: string; value: string }[];
}

function decode(data?: string): string {
  return data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
}

function findPart(p: Part, mime: string): string {
  if (p.mimeType === mime && p.body?.data) return decode(p.body.data);
  for (const c of p.parts ?? []) {
    const v = findPart(c, mime);
    if (v) return v;
  }
  return '';
}

export async function getMessage(token: string, id: string): Promise<GmailMessage> {
  const m = await get<{ id: string; internalDate: string; payload: Part }>(token, `/messages/${id}?format=full`);
  const headers = m.payload.headers ?? [];
  const h = (n: string) => headers.find(x => x.name.toLowerCase() === n)?.value ?? '';
  const plain = findPart(m.payload, 'text/plain');
  const html = plain ? '' : findPart(m.payload, 'text/html');
  const body = (plain || htmlToText(html) || decode(m.payload.body?.data)).slice(0, 8000);
  return {
    id: m.id,
    internalDate: Number(m.internalDate),
    from: h('from'),
    subject: h('subject'),
    messageIdHeader: h('message-id'),
    body,
  };
}
