const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
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
    service: 'kk-receipts-processor',
    event,
    ...fields
  }));
}

async function streamToString(stream) {
  return await stream.transformToString();
}

module.exports.process = async (event) => {
  for (const record of event.Records) {
    const sourceBucket = record.s3.bucket.name;
    const sourceKey = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, ' ')
    );

    const object = await s3.send(
      new GetObjectCommand({
        Bucket: sourceBucket,
        Key: sourceKey
      })
    );

    const body = await streamToString(object.Body);
    const receipt = JSON.parse(body);

    log('receipt.processing_started', {
      correlationId: receipt.correlationId,
      paymentId: receipt.paymentId,
      bucket: sourceBucket,
      key: sourceKey
    });

    const processedReceipt = {
      ...receipt,
      status: 'processed',
      processedAt: new Date().toISOString()
    };

    const outputKey =
      `processed-${receipt.paymentId}.json`;

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.OUTPUT_BUCKET,
        Key: outputKey,
        ContentType: 'application/json',
        Body: JSON.stringify(processedReceipt)
      })
    );

    log('receipt.processed', {
      correlationId: receipt.correlationId,
      paymentId: receipt.paymentId,
      bucket: process.env.OUTPUT_BUCKET,
      key: outputKey
    });
  }

  return {
    statusCode: 200
  };
};