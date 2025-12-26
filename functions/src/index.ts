import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

// ตรวจสอบว่า Init App ไปหรือยัง เพื่อป้องกัน Error init ซ้ำ
if (!admin.apps.length) {
  admin.initializeApp();
}

export const processHeavyTask = onDocumentCreated(
  {
    document: "orders/{orderId}",
    database: "dlt-db",
    region: "asia-southeast1", // ใช้ Region ให้ตรงกับที่คุณเลือก
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (event) => {
    // 1. ดึงข้อมูล Snapshot
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }

    const orderId = event.params.orderId;
    const orderData = snapshot.data();
    const orderRef = snapshot.ref;

    console.log(`🚀 [Start] Processing task: ${orderId}`);
    console.log("Datainformation", JSON.stringify(orderData));
    try {
      // ----------------------------------------------------
      // 🔥 FIX: เตรียมข้อมูลสำหรับ Update สถานะเป็น Processing
      // ----------------------------------------------------
      const processingUpdate: any = {
        status: "processing",
        updatedAt: FieldValue.serverTimestamp(),
      };

      // ✅ กันลืม: ถ้าตอนสร้างลืมใส่ createdAt, Backend จะเติมให้ตรงนี้เลย
      // เพื่อให้ Query ใน Frontend มองเห็นเอกสารนี้
      if (!orderData.createdAt) {
        console.log("⚠️ Missing createdAt, backfilling now...");
        processingUpdate.createdAt = FieldValue.serverTimestamp();
      }
      // Update ครั้งที่ 1: แจ้งว่าเริ่มทำแล้ว
      await orderRef.update(processingUpdate);

      console.log("Request to listCouponOnMarketplace", orderData);
      const body = {
        voucherId: orderData.voucherId,
        amount: orderData.amount,
        pricePerUnitTHB: orderData.pricePerUnitTHB,
        sellerWalletAddress: orderData.sellerWalletAddress,
      };
      const listOnMarketplace = await listCouponOnMarketplace(body);
      console.log("Response from listCouponOnMarketplace", listOnMarketplace);

      const result = {
        success: true,
        message: "Task processed successfully!",
        // ตัวอย่างการใช้ data เดิม
        processedData: orderData.payload || "No payload",
      };
      // ----------------------------------------------------

      // 3. งานเสร็จ: Update status เป็น Completed
      await orderRef.update({
        status: "completed",
        result: result,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`✅ [Done] Task ${orderId} completed.`);
    } catch (error: any) {
      console.error(`❌ [Error] Task ${orderId} failed:`, error);

      // 4. ถ้า Error ให้บันทึกสถานะ Error
      await orderRef.update({
        status: "error",
        error: error.message || "Unknown error",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);

const listCouponOnMarketplace = async (body: any) => {
  try {
    const apiUrl =
      "https://dlp-backofficebe-testnet.adldigitalservice.com" +
      "/coupon/seller/list-on-marketplace";
    const response = await fetch(apiUrl, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    console.log(data);
    if (response.status !== 200) {
      throw new Error(data.message);
    }
    return data;
  } catch (error) {
    console.log(error);
    throw error;
  }
};
