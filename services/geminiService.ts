
import { GoogleGenAI } from "@google/genai";
import { PalletType, InventoryRecord } from "../types";

export const analyzeInventory = async (palletTypes: PalletType[], records: InventoryRecord[]) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
      cartons: totalPallets * type.cartonsPerPallet,
      bundles: totalPallets * type.cartonsPerPallet * (type.bundlesPerCarton || 0)
    };
  });

  const totalDamaged = records.filter(r => r.condition && r.condition !== 'intact').length;

  const prompt = `بصفتك خبير في الخدمات اللوجستية وإدارة مخازن الكتب، حلل بيانات المخزون التالية:
  ${JSON.stringify(dataSummary)}
  إجمالي الشحنات (الطبليات) المتضررة: ${totalDamaged}
  
  المطلوب:
  1. تحليل كفاءة التوزيع بناءً على عدد الحزم والكراتين.
  2. تقديم توصية حول الجهد البشري المطلوب لفك الطبليات وتوزيع الحزم بناءً على الإجماليات.
  3. تحديد المرحلة الأكثر تضرراً وتأثير ذلك على "الحزم" النهائية التي ستصل للمدارس.
  
  أجب باللغة العربية بنقاط مختصرة جداً ومهنية.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini analysis error:", error);
    return "تعذر تحليل بيانات التلف حالياً. يرجى التأكد من صلاحية مفتاح الـ API.";
  }
};
