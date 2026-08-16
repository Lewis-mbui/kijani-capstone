const {
  S3Client,
  GetObjectCommand
} = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:4569',
  region: 'af-south-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'S3RVER',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'S3RVER'
  }
});

function log(event, fields = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'kk-receipts-notifier',
    event,
    ...fields
  }));
}

async function streamToString(stream) {
  return await stream.transformToString();
}

module.exports.notify = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;

    const key = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, ' ')
    );

    const object = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    const body = await streamToString(object.Body);
    const receipt = JSON.parse(body);

    log('receipt.notification_dispatched', {
      correlationId: receipt.correlationId,
      paymentId: receipt.paymentId,
      amount: receipt.amount,
      currency: receipt.currency,
      processedAt: receipt.processedAt,
      channel:
        process.env.NOTIFICATION_CHANNEL || 'log'
    });
  }

  return {
    statusCode: 200
  };
};