
import { GoogleGenAI, Type } from "@google/genai";
import { TrendAnalysis, ProductItem } from "../types";

// Lazy initialization to prevent crash if API key is missing during module load
let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("Gemini API key is missing. AI features will be disabled.");
      return null;
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

export const analyzeTrend = async (keyword: string): Promise<TrendAnalysis> => {
  const ai = getAI();
  if (!ai) throw new Error("AI service not initialized");

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the fashion/lifestyle trend for the keyword: "${keyword}". Provide detailed styling insights.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          keyword: { type: Type.STRING },
          trendScore: { type: Type.NUMBER },
          description: { type: Type.STRING },
          stylingTips: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendedItems: { type: Type.ARRAY, items: { type: Type.STRING } },
          colorPalette: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["keyword", "trendScore", "description", "stylingTips", "recommendedItems", "colorPalette"]
      }
    }
  });

  try {
    // Access response.text directly (do not call as a method).
    const data = JSON.parse(response.text || '{}');
    return data as TrendAnalysis;
  } catch (error) {
    console.error("Failed to parse Gemini response", error);
    throw new Error("Trend analysis failed.");
  }
};

/**
 * Simulates scraping product metadata from a URL using Gemini's reasoning.
 * Since real scraping is blocked by CORS in-browser, we use the model to predict/suggest metadata.
 */
export const extractProductMetadata = async (url: string): Promise<Partial<ProductItem>> => {
  const ai = getAI();
  if (!ai) return {};

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a product data extraction expert. Extract the EXACT product information from this URL: "${url}".
    
    CRITICAL RULES:
    1. DO NOT GUESS. If you cannot find the real product name or price, return "Unknown".
    2. Product Name: Extract the specific item name only. Remove any brand names or site suffixes (e.g., "Musinsa", "Coupang", "Olive Young").
    3. Price: Extract the current selling price in KRW. Digits only. If there's a range, pick the current sale price.
    4. Image: Find the direct URL to the main product image. 
    
    KNOWLEDGE BASE:
    - Musinsa: URLs like musinsa.com/products/ID or goods.musinsa.com/ID.
    - Coupang: URLs like coupang.com/vp/products/ID.
    - Olive Young: URLs like oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=ID.
    
    If the URL is from these platforms, use your knowledge of their typical product pages to provide the most accurate data possible. Return JSON format.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Precise product name or 'Unknown'" },
          price: { type: Type.STRING, description: "Price digits only or '0'" },
          image: { type: Type.STRING, description: "Direct product image URL or empty string" },
        },
        required: ["name", "price", "image"]
      }
    }
  });

  try {
    // Access response.text directly.
    const data = JSON.parse(response.text || '{}');
    return {
      name: data.name,
      price: data.price,
      image: data.image
    };
  } catch (error) {
    console.error("Failed to extract metadata", error);
    return {};
  }
};
