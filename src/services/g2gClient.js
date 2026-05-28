const crypto = require('crypto');
const axios = require('axios');

const BASE_URL = 'https://open-api.g2g.com';
const API_VERSION = 'v2';

function buildHeaders(urlPath) {
  const apiKey = process.env.G2G_API_KEY;
  const apiSecret = process.env.G2G_API_SECRET;
  const userId = process.env.G2G_USER_ID;
  const timestamp = Date.now().toString();

  const canonical = urlPath + apiKey + userId + timestamp;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(canonical)
    .digest('hex');

  console.log('[G2G] canonical string:', canonical);
  console.log('[G2G] signature:', signature.slice(0, 10) + '...');

  return {
    'g2g-api-key': apiKey,
    'g2g-userid': userId,
    'g2g-signature': signature,
    'g2g-timestamp': timestamp,
    'Content-Type': 'application/json'
  };
}

async function getOrderById(orderId) {
  const urlPath = `/${API_VERSION}/order/${orderId}`;
  const url = BASE_URL + urlPath;
  try {
    const res = await axios.get(url, { headers: buildHeaders(urlPath) });
    console.log('[G2G] getOrderById response:', res.status, JSON.stringify(res.data).slice(0, 300));
    return res.data?.payload;
  } catch (err) {
    console.error('[G2G] getOrderById error:', err.response?.status, JSON.stringify(err.response?.data));
    throw new Error(`getOrderById failed: ${err.response?.status} ${JSON.stringify(err.response?.data)}`);
  }
}

async function getStoreSettings() {
  const urlPath = `/${API_VERSION}/store`;
  const url = BASE_URL + urlPath;
  try {
    const res = await axios.get(url, { headers: buildHeaders(urlPath) });
    console.log('[G2G] getStore response:', res.status);
    return res.data?.payload;
  } catch (err) {
    console.error('[G2G] getStore error:', err.response?.status, JSON.stringify(err.response?.data));
    throw new Error(`getStore failed: ${err.response?.status} ${JSON.stringify(err.response?.data)}`);
  }
}

async function deliverCode(orderId, deliveryId, codes) {
  const urlPath = `/${API_VERSION}/order/${orderId}/delivery/${deliveryId}/code`;
  const url = BASE_URL + urlPath;
  const body = { code_list: codes.map(c => ({ code: c })) };
  try {
    const res = await axios.post(url, body, { headers: buildHeaders(urlPath) });
    return res.data;
  } catch (err) {
    console.error('[G2G] deliverCode error:', err.response?.data);
    throw new Error(`deliverCode failed: ${err.response?.status} ${JSON.stringify(err.response?.data)}`);
  }
}

module.exports = { getOrderById, getStoreSettings, deliverCode, buildHeaders };
