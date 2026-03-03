/**
 * QR Payment Service
 * Stub implementation — wire to your preferred QR payment provider (Zapper, SnapScan, etc.)
 */
exports.generateQRCode = async ({ orderId, amount, tenantId, reference }) => {
  // TODO: integrate with Zapper/SnapScan API to get a real QR code image
  return {
    image:     `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="%23f0f0f0"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" font-size="12">QR: ${reference}</text></svg>`,
    amount,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min
  };
};
