import { simpleParser } from 'mailparser';
import { addManualMaterial } from './manual-material.js';

export async function importEmlFiles(root, inputFiles) {
  const files = Array.isArray(inputFiles) ? inputFiles.slice(0, 100) : [];
  if (!files.length) throw new Error('EMLファイルを選択してください。');
  let timeline;
  for (const file of files) {
    if (!/\.eml$/i.test(String(file.name ?? ''))) throw new Error(`${file.name || '選択ファイル'} はEMLファイルではありません。`);
    const raw = Buffer.from(String(file.data ?? ''), 'base64');
    if (!raw.length) throw new Error(`${file.name} が空です。`);
    const mail = await simpleParser(raw, { skipHtmlToText: false, skipTextToHtml: true });
    const occurredAt = validDate(mail.date) ?? validDate(mail.headers.get('delivery-date'));
    if (!occurredAt) throw new Error(`${file.name} の送信日時を読み取れませんでした。`);
    const headers = [`件名: ${mail.subject || '（件名なし）'}`, mail.from?.text ? `差出人: ${mail.from.text}` : '', mail.to?.text ? `宛先: ${mail.to.text}` : '', mail.cc?.text ? `Cc: ${mail.cc.text}` : ''].filter(Boolean);
    const attachments = mail.attachments.map((attachment, index) => ({ name: attachment.filename || `添付ファイル-${index + 1}`, type: attachment.contentType || 'application/octet-stream', data: attachment.content.toString('base64') }));
    timeline = await addManualMaterial(root, { source: 'eml', occurredAt: occurredAt.toISOString(), text: `${headers.join('\n')}\n\n${String(mail.text ?? '').trim()}`.trim(), files: [{ name: file.name, type: 'message/rfc822', data: raw.toString('base64') }, ...attachments] });
  }
  return { imported: files.length, timeline };
}

function validDate(value) { const date = value instanceof Date ? value : new Date(String(value ?? '')); return Number.isNaN(date.valueOf()) ? null : date; }
