import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class McpClient {
  constructor(url, { token, headers = {} } = {}) { this.url = url; this.headers = { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }; this.sessionId = null; this.nextId = 1; }
  async request(method, params = {}) {
    const response = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...this.headers, ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }) });
    if (!response.ok) throw new Error(`MCP ${method} failed: ${response.status} ${await response.text()}`);
    this.sessionId ||= response.headers.get('mcp-session-id');
    const body = await response.text();
    const message = response.headers.get('content-type')?.includes('text/event-stream') ? parseSseJson(body) : JSON.parse(body || '{}');
    if (message.error) throw new Error(`MCP ${method}: ${message.error.message}`);
    return message.result;
  }
  initialize() { return this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'my-timeline', version: '0.1.0' } }); }
  listTools() { return this.request('tools/list'); }
  callTool(name, args) { return this.request('tools/call', { name, arguments: args }); }
}

export class StdioMcpClient {
  constructor(command, args = []) {
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    this.nextId = 1;
    this.pending = new Map();
    createInterface({ input: this.child.stdout }).on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      const waiter = this.pending.get(message.id); if (!waiter) return;
      this.pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    });
    this.child.on('exit', code => { for (const waiter of this.pending.values()) waiter.reject(new Error(`MCP bridge exited with code ${code}`)); this.pending.clear(); });
  }
  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  }
  initialize() { return this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'my-timeline', version: '0.1.0' } }); }
  listTools() { return this.request('tools/list'); }
  callTool(name, args) { return this.request('tools/call', { name, arguments: args }); }
  close() { this.child.stdin.end(); }
}
function parseSseJson(body) { for (const line of body.split(/\r?\n/).filter(x => x.startsWith('data:')).reverse()) { const value = line.slice(5).trim(); if (value && value !== '[DONE]') return JSON.parse(value); } return {}; }
export function contentTexts(result) { return (result?.content ?? []).filter(x => x.type === 'text').map(x => x.text); }
