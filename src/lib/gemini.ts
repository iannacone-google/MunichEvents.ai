import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || "" });

export interface ExtractedEvent {
  name: string;
  venue?: string;
  address?: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;
  startTime?: string; // HH:mm
  endTime?: string;
  price?: string;
  description?: string;
  startDateTime?: string; // ISO string
  endDateTime?: string; // ISO string
}

const eventSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "The name of the event" },
      venue: { type: Type.STRING, description: "The name of the venue (optional)" },
      address: { type: Type.STRING, description: "The address of the venue (optional)" },
      startDate: { type: Type.STRING, description: "The start date in YYYY-MM-DD format. If the year is missing, assume 2026." },
      endDate: { type: Type.STRING, description: "The end date in YYYY-MM-DD format (if available)" },
      startTime: { type: Type.STRING, description: "The start time in HH:mm format (optional)" },
      endTime: { type: Type.STRING, description: "The end time in HH:mm format (if available)" },
      price: { type: Type.STRING, description: "The price of the event (if available)" },
      description: { type: Type.STRING, description: "A short description of the event (optional)" },
    },
    required: ["name", "startDate"],
  }
};

const MUNICH_FILTER_INSTRUCTION = `
CRITICAL GEOGRAPHIC FILTERING:
1. Focus primarily on events in Munich (Monaco di Baviera) and its immediate surroundings (e.g., Augsburg, Freising, Dachau).
2. If the input contains a list of events in multiple different cities (e.g., Cologne, Frankfurt, Munich), ONLY extract the events located in Munich.
3. If the input describes a single event that is NOT in Munich but is nearby (e.g., Augsburg), you MAY extract it.
4. If the input contains multiple events all located in Munich or nearby, extract ALL of them.
5. Return an empty array if no events match the geographic criteria.
`;

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, onRetry?: (attempt: number, delay: number) => void): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = JSON.stringify(error).toLowerCase();
      const isTransientError = errorStr.includes("503") || errorStr.includes("unavailable") || errorStr.includes("overloaded");
      
      if (isTransientError && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000;
        console.warn(`Gemini 503 error. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        if (onRetry) onRetry(i + 1, delay);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function extractEventFromImage(base64Image: string, onRetry?: (attempt: number, delay: number) => void): Promise<ExtractedEvent[]> {
  console.log("Extracting events from image using Flash model...");
  const parts = [
    { text: `Extract all event details from this image. ${MUNICH_FILTER_INSTRUCTION} If information is missing, try to infer it. Return the result as a JSON array of objects. Assume current year is 2026 if not specified.` },
    { inlineData: { data: base64Image, mimeType: "image/png" } }
  ];

  const callGemini = async (useTools: boolean) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: eventSchema,
        ...(useTools ? { tools: [{ googleSearch: {} }] } : {})
      }
    });
    return JSON.parse(response.text);
  };

  try {
    // Attempt 1: With Google Search
    return await withRetry(() => callGemini(true), 3, onRetry);
  } catch (error: any) {
    const errorStr = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorStr.includes("spending cap") || 
                         errorStr.includes("429") || 
                         errorStr.includes("resource_exhausted") ||
                         errorStr.includes("quota");

    if (isQuotaError) {
      console.warn("Quota or Spending cap hit. Retrying in Super-Lite mode...");
      // Attempt 2: Without tools
      return await withRetry(() => callGemini(false), 3, onRetry);
    }
    throw error;
  }
}

export async function extractEventFromText(text: string, onRetry?: (attempt: number, delay: number) => void): Promise<ExtractedEvent[]> {
  console.log("Extracting events from raw text...");
  const parts = [
    { text: `Extract all event details from this raw text: "${text}". ${MUNICH_FILTER_INSTRUCTION} If information like the address is missing but a venue name is present, use Google Search to find the missing details. Return the result as a JSON array of objects. Assume current year is 2026 if not specified.` }
  ];

  const callGemini = async (useTools: boolean) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: eventSchema,
        ...(useTools ? { tools: [{ googleSearch: {} }] } : {})
      }
    });
    return JSON.parse(response.text);
  };

  try {
    // Attempt 1: With Google Search
    return await withRetry(() => callGemini(true), 3, onRetry);
  } catch (error: any) {
    const errorStr = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorStr.includes("spending cap") || 
                         errorStr.includes("429") || 
                         errorStr.includes("resource_exhausted") ||
                         errorStr.includes("quota");

    if (isQuotaError) {
      console.warn("Quota or Spending cap hit. Retrying in Super-Lite mode...");
      // Attempt 2: Without tools
      return await withRetry(() => callGemini(false), 3, onRetry);
    }
    throw error;
  }
}

export async function extractEventFromUrl(url: string, onRetry?: (attempt: number, delay: number) => void): Promise<ExtractedEvent[]> {
  console.log("Extracting events from URL using Flash model:", url);
  const isInstagram = url.includes('instagram.com');
  
  let extraContext = "";
  if (isInstagram) {
    try {
      console.log("Fetching Instagram metadata via Microlink...");
      const mlResponse = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}&palette=true&audio=true&video=true&iframe=true`);
      const mlData = await mlResponse.json();
      if (mlData.status === 'success' && mlData.data) {
        const { title, description, text } = mlData.data;
        extraContext = `
        ADDITIONAL METADATA FROM LINK PREVIEW:
        Title: ${title || 'N/A'}
        Description: ${description || 'N/A'}
        Extracted Text: ${text || 'N/A'}
        `;
        console.log("Microlink metadata fetched successfully.");
      }
    } catch (e) {
      console.warn("Microlink fetch failed, proceeding with Gemini only:", e);
    }
  }
  
  const parts = [
    { 
      text: isInstagram 
        ? `Extract all event details from this Instagram post: ${url}. ${MUNICH_FILTER_INSTRUCTION} 
           ${extraContext}
           
           IMPORTANT: Instagram often blocks direct access. Use the "ADDITIONAL METADATA" provided above (which comes from a link preview service) and Google Search to find the event details. 
           The description often contains the date, time, and venue.
           Return the result as a JSON array of objects. Assume current year is 2026 if not specified.`
        : `Extract all event details from this URL: ${url}. ${MUNICH_FILTER_INSTRUCTION} Return the result as a JSON array of objects. Assume current year is 2026 if not specified.` 
    }
  ];

  const callGemini = async (useTools: boolean) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: eventSchema,
        ...(useTools ? { tools: [{ googleSearch: {} }, { urlContext: {} }] } : {})
      }
    });
    return JSON.parse(response.text);
  };

  try {
    // Attempt 1: With tools
    return await withRetry(() => callGemini(true), 3, onRetry);
  } catch (error: any) {
    const errorStr = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorStr.includes("spending cap") || 
                         errorStr.includes("429") || 
                         errorStr.includes("resource_exhausted") ||
                         errorStr.includes("quota");

    if (isQuotaError) {
      console.warn("Quota or Spending cap hit. Retrying in Super-Lite mode...");
      // Attempt 2: Without tools
      return await withRetry(() => callGemini(false), 3, onRetry);
    }
    throw error;
  }
}
