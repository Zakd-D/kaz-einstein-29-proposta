// Registro de acessos da proposta Einstein 29
// Grava cada cadastro numa planilha CSV dentro da pasta do projeto (_registros/acessos.csv).
// Sem dependências: HTTP + WebSocket implementados com o módulo nativo do Node.
//
// Uso:  node registro-server.mjs
//       (deixe a janela aberta enquanto a proposta é usada)

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTA = 8787;
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.join(AQUI, '_registros');
const CSV = path.join(PASTA, 'acessos.csv');
const CABECALHO = 'data_hora;nome;email;codigo;origem;ip\n';

fs.mkdirSync(PASTA, { recursive: true });
if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, '\ufeff' + CABECALHO, 'utf8');

function agora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function limpar(v) {
  return String(v ?? '').replace(/[;\r\n]+/g, ' ').trim().slice(0, 120);
}

function gravar(registro, ip) {
  const nome = limpar(registro.nome);
  const email = limpar(registro.email);
  const codigo = limpar(registro.codigo);
  if (!nome || !email) return false;
  const origem = limpar(registro.origem || 'proposta-web');
  const linha = `${agora()};${nome};${email};${codigo};${origem};${limpar(ip)}\n`;
  fs.appendFileSync(CSV, linha, 'utf8');
  console.log(`[registro] ${nome} <${email}> código ${codigo} · ${ip}`);
  return true;
}

// ---------- HTTP (POST /registro) ----------
const servidor = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  if (req.method === 'GET' && req.url === '/status') {
    const total = Math.max(fs.readFileSync(CSV, 'utf8').split('\n').filter(Boolean).length - 1, 0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, planilha: CSV, registros: total }));
    return;
  }

  if (req.method === 'POST' && req.url === '/registro') {
    let corpo = '';
    req.on('data', (c) => { corpo += c; if (corpo.length > 4000) req.destroy(); });
    req.on('end', () => {
      let dados = {};
      try { dados = JSON.parse(corpo); } catch { dados = Object.fromEntries(new URLSearchParams(corpo)); }
      const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
      const ok = gravar(dados, ip);
      res.writeHead(ok ? 201 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ---------- WebSocket (mesmo porto, frames de texto) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

servidor.on('upgrade', (req, socket) => {
  const chave = req.headers['sec-websocket-key'];
  if (!chave) { socket.destroy(); return; }
  const aceite = crypto.createHash('sha1').update(chave + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${aceite}\r\n\r\n`
  );

  const ip = (socket.remoteAddress || '').replace('::ffff:', '');
  let buffer = Buffer.alloc(0);

  socket.on('data', (parte) => {
    buffer = Buffer.concat([buffer, parte]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const mascarado = (buffer[1] & 0x80) === 0x80;
      let tamanho = buffer[1] & 0x7f;
      let desloc = 2;
      if (tamanho === 126) { if (buffer.length < 4) return; tamanho = buffer.readUInt16BE(2); desloc = 4; }
      else if (tamanho === 127) { if (buffer.length < 10) return; tamanho = Number(buffer.readBigUInt64BE(2)); desloc = 10; }
      const mascara = mascarado ? buffer.subarray(desloc, desloc + 4) : null;
      if (mascarado) desloc += 4;
      if (buffer.length < desloc + tamanho) return;
      const bruto = buffer.subarray(desloc, desloc + tamanho);
      buffer = buffer.subarray(desloc + tamanho);

      if (opcode === 0x8) { socket.end(); return; }

      const dados = Buffer.from(bruto);
      if (mascara) for (let i = 0; i < dados.length; i++) dados[i] ^= mascara[i % 4];
      if (opcode !== 0x1) continue;

      try {
        const registro = JSON.parse(dados.toString('utf8'));
        if (gravar(registro, ip)) {
          const resposta = Buffer.from(JSON.stringify({ ok: true }));
          socket.write(Buffer.concat([Buffer.from([0x81, resposta.length]), resposta]));
        }
      } catch { /* payload inválido: ignora */ }
    }
  });

  socket.on('error', () => {});
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log('Registro de acessos ativo');
  console.log(`  HTTP  : http://127.0.0.1:${PORTA}/status`);
  console.log(`  WS    : ws://127.0.0.1:${PORTA}`);
  console.log(`  Planilha: ${CSV}`);
  console.log('Deixe esta janela aberta enquanto a proposta estiver em uso.');
});
