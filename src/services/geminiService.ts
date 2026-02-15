import { GoogleGenAI, Type } from "@google/genai";
import type { OCRResult } from "../types";

const STORAGE_API_KEY = "slidechange.gemini_api_key";

const getRuntimeApiKey = () => {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_API_KEY)?.trim();
    if (stored) return stored;
  }

  return String(process.env.API_KEY || process.env.GEMINI_API_KEY || "").trim();
};

export const analyzeTextInImage = async (base64Image: string): Promise<OCRResult> => {
  const apiKey = getRuntimeApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "image/png",
            data: base64Image.split(",")[1],
          },
        },
        {
          text: `Identify the Korean text in this image snippet.
          Estimate the following typography properties:
          1. The exact text content.
          2. Approximate font size in pixels.
          3. Font weight as a numeric CSS weight between 100 and 900.
          4. Dominant text color in hex.
          5. Most likely font family NAME used in the text.
             - Prefer concrete names such as Pretendard, Noto Sans KR, Nanum Gothic, Nanum Myeongjo, IBM Plex Sans KR, Malgun Gothic, Batang, Gulim, Inter, Roboto, Arial, Times New Roman, Courier New.
             - Return one CSS-usable font family string only.
             - If uncertain, return sans-serif.
          6. Estimated letter spacing in px (can be negative, typical range -1.0 to 4.0).
          7. Estimated line height multiplier (typical range 1.0 to 1.8).
          8. Dominant background color in hex behind the text.
          Return ONLY a JSON object with keys: text, fontSize, fontWeight, fontColor, fontFamily, letterSpacing, lineHeight, backgroundColor.`,
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          fontSize: { type: Type.NUMBER },
          fontWeight: { type: Type.NUMBER },
          fontColor: { type: Type.STRING },
          fontFamily: { type: Type.STRING },
          letterSpacing: { type: Type.NUMBER },
          lineHeight: { type: Type.NUMBER },
          backgroundColor: { type: Type.STRING },
        },
        required: ["text", "fontSize", "fontWeight", "fontColor", "fontFamily", "letterSpacing", "lineHeight", "backgroundColor"],
      },
    },
  });

  try {
    const data = JSON.parse(response.text || "{}");
    return {
      text: data.text || "",
      fontSize: data.fontSize || 16,
      fontWeight: Number.parseInt(String(data.fontWeight || "500"), 10) || 500,
      fontColor: data.fontColor || "#000000",
      fontFamily: data.fontFamily || "sans-serif",
      letterSpacing: typeof data.letterSpacing === "number" ? data.letterSpacing : 0,
      lineHeight: typeof data.lineHeight === "number" ? data.lineHeight : 1.2,
      backgroundColor: data.backgroundColor || "#ffffff",
    };
  } catch (error) {
    console.error("Failed to parse Gemini response", error);
    return {
      text: "OCR Error",
      fontSize: 16,
      fontWeight: 500,
      fontColor: "#000000",
      fontFamily: "sans-serif",
      letterSpacing: 0,
      lineHeight: 1.2,
      backgroundColor: "#ffffff",
    };
  }
};
