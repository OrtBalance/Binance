const https = require('https');
const crypto = require('crypto');

// --- Configure your CoinDCX API credentials here ---
const API_KEY = '3050fc182f00278bb14f742c69408361b11fc7dae61ee26d';
const API_SECRET = 'c9c3f2458bead1e00838208eea0f36380e9cedcd6ab5472381b69f3fee41f6c6';

// Check interval in ms (60000 = 1 minute). Set to 0 for a single check.
const CHECK_INTERVAL_MS = 0;

const API_HOST = 'api.coindcx.com';
const BALANCES_PATH = '/exchange/v1/users/balances';

function sign(jsonBody) {
  return crypto.createHmac('sha256', API_SECRET).update(jsonBody).digest('hex');
}

function getBalances() {
  return new Promise((resolve, reject) => {
    const body = { timestamp: Date.now() };
    const jsonBody = JSON.stringify(body);
    const signature = sign(jsonBody);

    const req = https.request(
      {
        hostname: API_HOST,
        path: BALANCES_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonBody),
          'X-AUTH-APIKEY': API_KEY,
          'X-AUTH-SIGNATURE': signature,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200) {
              const message =
                json.message || json.error || json.msg || JSON.stringify(json);
              reject(new Error(`${message} (HTTP ${res.statusCode})`));
            } else if (!Array.isArray(json)) {
              reject(new Error(json.message || json.error || 'Unexpected response format'));
            } else {
              resolve(json);
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('error', reject);
    req.write(jsonBody);
    req.end();
  });
}

function formatBalance(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function printBalances(balances) {
  const timestamp = new Date().toLocaleString();
  const nonZero = balances.filter(
    (b) => Number(b.balance) > 0 || Number(b.locked_balance) > 0
  );

  console.log('\n' + '='.repeat(60));
  console.log(`CoinDCX Balance Check — ${timestamp}`);
  console.log('='.repeat(60));

  if (nonZero.length === 0) {
    console.log('No assets with balance found.');
    return;
  }

  console.log(
    `${'Currency'.padEnd(12)} ${'Available'.padStart(18)} ${'Locked'.padStart(18)} ${'Total'.padStart(18)}`
  );
  console.log('-'.repeat(60));

  for (const { currency, balance, locked_balance } of nonZero) {
    const total = Number(balance) + Number(locked_balance);
    console.log(
      `${currency.padEnd(12)} ${formatBalance(balance).padStart(18)} ${formatBalance(locked_balance).padStart(18)} ${formatBalance(total).padStart(18)}`
    );
  }

  console.log('-'.repeat(60));
  console.log(`Assets with balance: ${nonZero.length}`);
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
  console.error('  2. Permissions: enable balance/read access on the API key');
  console.error(`  3. IP whitelist: if restricted, add this IP -> ${ip}`);
  console.error('  4. Key source: create keys at coindcx.com -> Settings -> API');
  console.error('  5. Secret: re-copy the secret (shown only once when the key was created)');
}

async function checkBalance() {
  try {
    const balances = await getBalances();
    printBalances(balances);
  } catch (error) {
    console.error('\nBalance check failed:', error.message);

    const msg = error.message.toLowerCase();
    if (msg.includes('invalid') && (msg.includes('key') || msg.includes('api'))) {
      await printInvalidKeyHelp();
    } else if (msg.includes('signature') || msg.includes('unauthorized') || msg.includes('401')) {
      console.error('The API secret may be wrong. Re-copy it from CoinDCX API Management.');
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
    console.error('Set your COINDCX API_KEY and API_SECRET at the top of this file.');
    process.exit(1);
  }

  console.log('CoinDCX Balance Bot started.');
  console.log(`Mode: ${CHECK_INTERVAL_MS <= 0 ? 'single check' : `every ${CHECK_INTERVAL_MS / 1000}s`}`);

  checkBalance();

  if (CHECK_INTERVAL_MS > 0) {
    setInterval(checkBalance, CHECK_INTERVAL_MS);
  }
}

main();
