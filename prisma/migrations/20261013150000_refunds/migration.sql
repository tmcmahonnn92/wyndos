-- Refunds: a payment with a negative amount, linked to the payment it refunds.
ALTER TABLE "Payment" ADD COLUMN "refundOfId" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "refundWriteOff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "goCardlessRefundId" TEXT;
CREATE UNIQUE INDEX "Payment_goCardlessRefundId_key" ON "Payment"("goCardlessRefundId");
CREATE INDEX "Payment_refundOfId_idx" ON "Payment"("refundOfId");
