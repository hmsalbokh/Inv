
import { GoogleGenAI } from "@google/genai";
import { PalletType, InventoryRecord } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeInventory = async (palletTypes: PalletType[], records: InventoryRecord[]) => {
  const dataSummary = palletTypes.map(type => {
    const typeRecords = records.filter(r => r.palletTypeId === type.id);
    const totalPallets = typeRecords.length;
    const received = typeRecords.filter(r => r.status === 'received');
    const damaged = received.filter(r => r.condition && r.condition !== 'intact').length;
    
    return {
      stage: type.stageName,
      total: totalPallets,
      received: received.length,
      damaged: damaged,
      cartons: totalPallets * type.cartonsPerPallet
    };
  });

  const totalDamaged = records.filter(r => r.condition && r.condition !== 'intact').length;

  const prompt = `بصفتك خبير في الخدمات اللوجستية، حلل بيانات المخزون التالية:
  ${JSON.stringify(dataSummary)}
  إجمالي الشحنات المتضررة: ${totalDamaged}
  
  المطلوب:
  1. تحليل نسبة التلف مقارنة بالاستلام.
  2. تحديد المرحلة الأكثر تضرراً إن وجدت.
  3. تقديم نصيحة لتقليل التلف أثناء النقل.
  
  أجب باللغة العربية بنقاط مختصرة جداً ومهنية.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini analysis error:", error);
    return "تعذر تحليل بيانات التلف حالياً.";
  }
};
