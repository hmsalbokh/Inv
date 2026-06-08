import { PalletType, InventoryRecord } from "../types";

export const analyzeInventory = async (palletTypes: PalletType[], records: InventoryRecord[]) => {
  try {
    const response = await fetch("/api/analyze-inventory", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ palletTypes, records }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to analyze inventory on server");
    }
    return data.text || "لا توجد نتيجة للتحليل.";
  } catch (error: any) {
    console.error("Gemini analysis error:", error);
    return error?.message || "تعذر تحليل بيانات التلف حالياً. يرجى التحقق من لوحة التحكم ومكتبة الاتصال.";
  }
};
