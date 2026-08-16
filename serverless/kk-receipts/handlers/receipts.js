const crypto = require('node:crypto');

const {
  S3Client,
  PutObjectCommand
} = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  endpoint:
    process.env.S3_ENDPOINT ||
    'http://localhost:4569',

  region:
    process.env.AWS_REGION ||
    'af-south-1',

  forcePathStyle: true,

  credentials: {
    accessKeyId:
      process.env.AWS_ACCESS_KEY_ID ||
      'S3RVER',

    secretAccessKey:
      process.env.AWS_SECRET_ACCESS_KEY ||
      'S3RVER'
  }
});

function log(event, fields = {}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'kk-receipts',
      event,
      ...fields
    })
  );
}

const generate = async (event) => {
  const body =
    typeof event.body === 'string'
      ? JSON.parse(event.body)
      : (event.body || {});

  const orderId = body.orderId;

  if (!orderId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'orderId is required'
      })
    };
  }

  const incomingCorrelationId =
    event.headers?.['x-correlation-id'] ||
    event.headers?.['X-Correlation-ID'];

  const correlationId =
    incomingCorrelationId ||
    crypto.randomUUID();

  const receipt = {
    receiptId: `RCP-${Date.now()}`,
    orderId,
    amount: body.amount,
    currency:
      body.currency ||
      process.env.DEFAULT_CURRENCY ||
      'KES',
    correlationId,
    createdAt: new Date().toISOString(),
    status: 'generated'
  };

  const key =
    `receipt-${orderId}.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.OUTPUT_BUCKET,
      Key: key,
      Body: JSON.stringify(receipt),
      ContentType: 'application/json'
    })
  );

  log('receipt.generated', {
    correlationId,
    orderId,
    receiptId: receipt.receiptId,
    bucket: process.env.OUTPUT_BUCKET,
    key
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId
    },
    body: JSON.stringify({
      receiptId: receipt.receiptId,
      orderId,
      status: 'queued',
      correlationId
    })
  };
};

module.exports = {
  generate
};