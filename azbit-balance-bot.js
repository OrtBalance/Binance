const https = require('https');
const crypto = require('crypto');

// --- Configure your Azbit API credentials here ---
const API_KEY = 'k0sfFpgvHMzlm8hCQ6yUHv4OM0SbriaBYVyuww';
const API_SECRET = 'YuxXWDfiwgJeXs9XISB0eLLE9GPBskdmGpVTF3JaPrdUv8aP4f5-cfUeU06x2M6hD3bpNA';

// Check interval in ms (60000 = 1 minute). Set to 0 for a single check.
const CHECK_INTERVAL_MS = 0;

const API_HOST = 'data.azbit.com';
const API_BASE = 'https://data.azbit.com/api';
const BALANCES_PATH = '/wallets/balances';
const REQUEST_URL = `${API_BASE}${BALANCES_PATH}`;

function sign(requestUrl, requestBodyString = '') {
  const signatureText = API_KEY + requestUrl + requestBodyString;
  return crypto.createHmac('sha256', API_SECRET).update(signatureText).digest('hex');
}

function getBalances() {
  return new Promise((resolve, reject) => {
    const requestBodyString = '';
    const signature = sign(REQUEST_URL, requestBodyString);

    const req = https.request(
      {
        hostname: API_HOST,
        path: `/api${BALANCES_PATH}`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'API-PublicKey': API_KEY,
          'API-Signature': signature,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const trimmed = data.trim();
          if (!trimmed) {
            reject(new Error(`Empty response from Azbit (HTTP ${res.statusCode})`));
            return;
          }

          let json;
          try {
            json = JSON.parse(trimmed);
          } catch {
            // Azbit often returns plain-text errors, e.g. "401 Unauthorized - Unknown API-PublicKey"
            reject(new Error(trimmed));
            return;
          }

          if (res.statusCode !== 200) {
            const message =
              json.message || json.error || json.title || JSON.stringify(json);
            reject(new Error(`${message} (HTTP ${res.statusCode})`));
          } else if (!json.balances && !json.balancesBlockedInOrder) {
            reject(new Error(json.message || json.error || 'Unexpected response format'));
          } else {
            resolve(json);
          }
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

function formatBalance(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function mergeBalances(data) {
  const byCurrency = new Map();

  for (const item of data.balances || []) {
    byCurrency.set(item.currencyCode, {
      currency: item.currencyCode,
      available: Number(item.amount) || 0,
      locked: 0,
    });
  }

  for (const item of data.balancesBlockedInOrder || []) {
    const existing = byCurrency.get(item.currencyCode) || {
      currency: item.currencyCode,
      available: 0,
      locked: 0,
    };
    existing.locked = Number(item.amount) || 0;
    byCurrency.set(item.currencyCode, existing);
  }

  return Array.from(byCurrency.values());
}

function printBalances(data) {
  const timestamp = new Date().toLocaleString();
  const merged = mergeBalances(data);
  const nonZero = merged.filter((b) => b.available > 0 || b.locked > 0);

  console.log('\n' + '='.repeat(60));
  console.log(`Azbit Balance Check — ${timestamp}`);
  console.log('='.repeat(60));

  if (nonZero.length === 0) {
    console.log('No assets with balance found.');
  } else {
    console.log(
      `${'Currency'.padEnd(12)} ${'Available'.padStart(18)} ${'Locked'.padStart(18)} ${'Total'.padStart(18)}`
    );
    console.log('-'.repeat(60));

    for (const { currency, available, locked } of nonZero) {
      const total = available + locked;
      console.log(
        `${currency.padEnd(12)} ${formatBalance(available).padStart(18)} ${formatBalance(locked).padStart(18)} ${formatBalance(total).padStart(18)}`
      );
    }

    console.log('-'.repeat(60));
    console.log(`Assets with balance: ${nonZero.length}`);
  }

  if (data.totalUsdt != null || data.totalBtc != null) {
    console.log('-'.repeat(60));
    if (data.totalUsdt != null) {
      console.log(`Portfolio total (USDT): ${formatBalance(data.totalUsdt)}`);
    }
    if (data.totalBtc != null) {
      console.log(`Portfolio total (BTC):  ${formatBalance(data.totalBtc)}`);
    }
    if (data.totalInOrderUsdt != null && Number(data.totalInOrderUsdt) > 0) {
      console.log(`In orders (USDT):       ${formatBalance(data.totalInOrderUsdt)}`);
    }
  }
}

function getPublicIp() {
  return new Promise((resolve) => {
    https
      .get('https://api.ipify.org?format=json', (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data).ip);
          } catch {
            resolve('unknown');
          }
        });
      })
      .on('error', () => resolve('unknown'));
  });
}

async function printInvalidKeyHelp() {
  const ip = await getPublicIp();
  console.error('\nFix checklist:');
  console.error(`  1. API host: ${API_HOST}`);
  console.error('  2. Permissions: enable read-only access on the API key');
  console.error(`  3. IP whitelist: if restricted, add this IP -> ${ip}`);
  console.error('  4. Key source: create keys at azbit.com -> Settings -> API Keys');
  console.error('  5. Secret: re-copy the secret (shown only once when the key was created)');
}

async function checkBalance() {
  try {
    const data = await getBalances();
    printBalances(data);
  } catch (error) {
    console.error('\nBalance check failed:', error.message);

    const msg = error.message.toLowerCase();
    if (
      msg.includes('unknown api-publickey') ||
      msg.includes('invalid') && (msg.includes('key') || msg.includes('api'))
    ) {
      console.error('Azbit does not recognize this API public key.');
      await printInvalidKeyHelp();
    } else if (
      msg.includes('signature') ||
      msg.includes('unauthorized') ||
      msg.includes('401')
    ) {
      console.error('Authentication failed. Re-check your API key and secret in Azbit API Management.');
      await printInvalidKeyHelp();
    } else if (msg.includes('ip')) {
      const ip = await getPublicIp();
      console.error(`Your IP (${ip}) may not be whitelisted on this API key.`);
    }
  }
}

function main() {
  if (
    !API_KEY ||
    !API_SECRET ||
    API_KEY.includes('your_api_key') ||
    API_SECRET.includes('your_api_secret')
  ) {
    console.error('Set your AZBIT API_KEY and API_SECRET at the top of this file.');
    process.exit(1);
  }

  console.log('Azbit Balance Bot started.');
  console.log(`Mode: ${CHECK_INTERVAL_MS <= 0 ? 'single check' : `every ${CHECK_INTERVAL_MS / 1000}s`}`);

  checkBalance();

  if (CHECK_INTERVAL_MS > 0) {
    setInterval(checkBalance, CHECK_INTERVAL_MS);
  }
}

main();
