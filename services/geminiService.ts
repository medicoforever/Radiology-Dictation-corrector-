
import { GoogleGenAI, Type, GenerateContentResponse, Chat } from "@google/genai";
import { DEFAULT_GEMINI_PROMPT, TEMPLATE_GEMINI_PROMPT, REPORT_TEMPLATES, ERROR_IDENTIFIER_PROMPT, INITIAL_AGENT_PROMPT, REFINEMENT_AGENT_PROMPT, SYNTHESIZER_AGENT_PROMPT, IMAGE_ONLY_GEMINI_PROMPT, IMAGE_TRANSCRIPTION_AGENT_PROMPT } from '../constants';
import { IdentifiedError } from "../types";

const getApiKey = (): string => {
  const key = localStorage.getItem('gemini_api_key');
  if (!key) {
    throw new Error("Gemini API Key is missing. Please add it in the settings.");
  }
  return key;
};

const getAIClient = () => {
  return new GoogleGenAI({ apiKey: getApiKey() });
};

// Utility function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry utility with exponential backoff and error classification
async function retryOperation<T>(operation: () => Promise<T>, retries = 3, initialDelay = 1000): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            // Check for 429 (Resource Exhausted) or 503 (Service Unavailable)
            const isRateLimit = error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED') || error.status === 429;
            const isServerOverload = error.message?.includes('503') || error.status === 503;

            if (isRateLimit || isServerOverload) {
                // If it's the last attempt, don't wait, just throw
                if (i === retries - 1) break;
                
                const waitTime = initialDelay * Math.pow(2, i);
                console.warn(`API Rate Limit/Error hit. Retrying in ${waitTime}ms... (Attempt ${i + 1}/${retries})`);
                await delay(waitTime);
                continue;
            }
            // Throw immediately for other errors (like 400 Bad Request)
            throw error;
        }
    }
    throw lastError;
}

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      // remove the "data:audio/ogg;base64," part
      resolve(base64data.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const base64ToBlob = (base64: string, mimeType: string): Blob => {
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  } catch (e) {
    console.error("Failed to convert base64 to Blob:", e);
    // Return an empty blob on error
    return new Blob([], { type: mimeType });
  }
};


const getCleanMimeType = (blob: Blob): string => {
    let mimeType = blob.type;
    if (!mimeType) {
        // Fallback for files without a MIME type, maintaining original behavior.
        return 'audio/ogg';
    }
    // Handle WebM variations. It can be audio/webm or video/webm for audio-only files.
    // Also, strip codec information which might not be supported by the API.
    if (mimeType.startsWith('audio/webm') || mimeType.startsWith('video/webm')) {
        return 'audio/webm';
    }
    // For other types, just strip potential codec/parameter info
    return mimeType.split(';')[0];
};

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        findings: {
            type: Type.ARRAY,
            items: {
                type: Type.STRING
            },
            description: "An array of strings, where each string is a corrected sentence or paragraph of the radiology findings."
        }
    }
};

const runImageAgenticAnalysis = async (imageBlobs: Blob[]): Promise<string[]> => {
    const ai = getAIClient();
    const transcriptions: string[] = [];

    // SEQUENTIAL EXECUTION to respect rate limits
    for (const imageBlob of imageBlobs) {
        const base64Image = await blobToBase64(imageBlob);
        const imagePart = {
            inlineData: {
                mimeType: imageBlob.type,
                data: base64Image
            }
        };
        const textPart = { text: IMAGE_TRANSCRIPTION_AGENT_PROMPT };

        try {
            // Attempt 1: Try Gemini 3 Pro (best quality)
            const result = await retryOperation(() => ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: { parts: [textPart, imagePart] }
            }));
            if (result.text) transcriptions.push(result.text);
        } catch (error: any) {
            console.warn("Gemini 3 Pro failed, trying fallbacks...", error.message);
            try {
                // Attempt 2: Try Gemini 2.5 Pro
                const result = await retryOperation(() => ai.models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: { parts: [textPart, imagePart] }
                }));
                if (result.text) transcriptions.push(result.text);
            } catch (err2) {
                // Attempt 3: Try Gemini 2.5 Flash (most reliable for quota)
                console.warn("Gemini 2.5 Pro failed, falling back to Flash...", err2);
                const result = await retryOperation(() => ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: { parts: [textPart, imagePart] }
                }));
                if (result.text) transcriptions.push(result.text);
            }
        }
        // Small delay between images
        await delay(500); 
    }
    
    // Filter out any empty or failed transcriptions
    const validTranscriptions = transcriptions.filter(t => t && t.trim().length > 0);

    if (validTranscriptions.length === 0) {
        throw new Error("Could not extract any text from the provided images.");
    }
    
    // Step 2: Synthesizer Agent
    const concatenatedTranscriptions = validTranscriptions.join('\n\n--- DOCUMENT BREAK ---\n\n');
    
    const synthesizerPrompt = IMAGE_ONLY_GEMINI_PROMPT.replace(
        '[INSERT_TRANSCRIPTIONS_HERE]',
        `Here are the raw transcriptions from the medical documents:\n\n${concatenatedTranscriptions}`
    );

    let synthesizerResponse;
    // Try synthesis with fallbacks
    try {
        synthesizerResponse = await retryOperation(() => ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: { parts: [{ text: synthesizerPrompt }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        }));
    } catch (error: any) {
        try {
             synthesizerResponse = await retryOperation(() => ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: { parts: [{ text: synthesizerPrompt }] },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema
                }
            }));
        } catch (err2) {
             synthesizerResponse = await retryOperation(() => ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [{ text: synthesizerPrompt }] },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema
                }
            }));
        }
    }

    const jsonString = synthesizerResponse.text;
    if (!jsonString) {
      throw new Error("Synthesizer agent returned an empty response.");
    }

    const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleanedJsonString);

    if (result && Array.isArray(result.findings)) {
      return result.findings;
    } else {
      throw new Error("Invalid data structure from synthesizer agent. Expected a 'findings' array.");
    }
};


export const processMedia = async (audioBlob: Blob | null, imageBlobs: Blob[] | null, model: string, customPrompt?: string): Promise<string[]> => {
  const hasImages = imageBlobs && imageBlobs.length > 0;

  if (hasImages) {
    // NEW AGENTIC WORKFLOW FOR IMAGES. Ignores audio blob and custom prompts.
    try {
      return await runImageAgenticAnalysis(imageBlobs);
    } catch (error) {
      console.error("Error in image agentic analysis:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to process images: ${error.message}`);
      }
      throw new Error("An unknown error occurred during image processing.");
    }
  }

  // --- Fallback to original audio-only logic if no images are present ---
  if (!audioBlob) {
    // This case should be handled by the UI, but let's be safe.
    // If there are no images (checked above) and no audio, we can't proceed.
    throw new Error("Cannot process with no media provided.");
  }
  
  const ai = getAIClient();
  const targetModel = model;

  let basePrompt: string;
  const useTemplate = customPrompt?.toLowerCase().includes('report template');
  if (useTemplate) {
      const selectedTemplate = REPORT_TEMPLATES.find(t =>
          customPrompt!.toLowerCase().includes(t.name.toLowerCase())
      );
      if (selectedTemplate) {
          const templateContent = `## ${selectedTemplate.name} Normal Report Template\n${selectedTemplate.content}`;
          basePrompt = TEMPLATE_GEMINI_PROMPT.replace('[INSERT_TEMPLATE_HERE]', templateContent);
      } else {
          basePrompt = TEMPLATE_GEMINI_PROMPT.replace('[INSERT_TEMPLATE_HERE]', '// Template mentioned in custom instructions was not found.');
      }
  } else {
      basePrompt = DEFAULT_GEMINI_PROMPT;
  }
  
  const finalPrompt = customPrompt 
    ? `${basePrompt}\n\nCustom Instructions (Reminder):\n${customPrompt}` 
    : basePrompt;
  
  const parts: any[] = [{ text: finalPrompt }];

  const base64Audio = await blobToBase64(audioBlob);
  parts.push({
    inlineData: {
      mimeType: getCleanMimeType(audioBlob),
      data: base64Audio,
    },
  });

  try {
    const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
      model: targetModel,
      contents: { parts: parts },
      config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
      }
    }));

    const jsonString = response.text;
    if (!jsonString) {
      throw new Error("API returned an empty response.");
    }

    const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleanedJsonString);

    if (result && Array.isArray(result.findings)) {
      return result.findings;
    } else {
      throw new Error("Invalid data structure in API response. Expected a 'findings' array.");
    }
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to process media: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API.");
  }
};

// Re-export processAudio as a wrapper for backward compatibility if needed, 
// though we will update calls to use processMedia.
export const processAudio = (audioBlob: Blob, model: string, customPrompt?: string) => processMedia(audioBlob, null, model, customPrompt);

export const continueAudioDictation = async (existingText: string, audioBlob: Blob, customPrompt?: string): Promise<string> => {
  const ai = getAIClient();
  const base64Audio = await blobToBase64(audioBlob);

  let prompt = `You are an expert medical transcriptionist specializing in radiology. A user is adding to their dictation.
The existing text is: "${existingText}".

Your task is to transcribe and correct ONLY the new audio provided. Your transcription should be a direct continuation of the existing text.

Follow these strict instructions to produce a clean and accurate continuation:
1. Analyze each word from the new audio for its contextual meaning within radiology and replace any incorrect words with the proper medical terminology. For example, a speech-to-text tool might misinterpret 'radiology findings' as something unrelated.
2. **Specific Transcription Rules**:
    - Transcribe "few" exactly as "few", not "a few".
    - Replace the dictated word "query" with a question mark symbol "?".
    - Transcribe "status post" as the abbreviation "S/p".
    - Format dictated dimensions like "8 mm into 9 mm" as "8 x 9 mm".
    - For comparative phrases like "right more than left", use the format "(R > L)". Similarly, for "left more than right", use "(L > R)".
    - Abbreviate "complaints of" to "C/o".
    - Abbreviate "history of" to "H/o".
3. Completely ignore all non-verbal sounds (like coughing, sneezing) and any irrelevant side-conversations from the new audio. However, you MUST include any dictation related to the clinical profile or patient information.
4. If the new audio includes languages other than English, transcribe and translate the relevant medical findings into proper English.
5. Do not repeat any of the existing text in your output.
6. Your final output must be ONLY the newly corrected text, with no additional commentary, introductions, or explanations. Do not use any markdown formatting (like asterisks for bolding).`;

  if (customPrompt) {
    prompt += `\n\nAdditionally, follow these custom instructions:\n${customPrompt}`;
  }

  const textPart = { text: prompt };
  const audioPart = {
    inlineData: {
      mimeType: getCleanMimeType(audioBlob),
      data: base64Audio,
    },
  };

  try {
    const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: { parts: [textPart, audioPart] },
    }));

    const resultText = response.text?.trim();
    if (!resultText) {
      throw new Error("API returned an empty response for audio continuation.");
    }
    return resultText;
  } catch (error) {
    console.error("Error calling Gemini API for audio continuation:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to process audio continuation: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for audio continuation.");
  }
};

export const modifyFindingWithAudio = async (originalText: string, audioBlob: Blob, customPrompt?: string): Promise<string> => {
  const ai = getAIClient();
  const base64Audio = await blobToBase64(audioBlob);

  let prompt = `You are an expert medical transcriptionist assistant. You will be given an existing medical finding text and an audio recording. The audio contains instructions and/or additional dictation to modify the original finding.

Your task is to return a single, updated string that intelligently incorporates the changes from the audio.
- If the audio provides additional details, integrate them coherently and grammatically into the existing text.
- If the audio provides an explicit instruction (e.g., "change 'normal' to 'unremarkable'", "remove the last sentence"), apply that instruction precisely.
- Correct any speech-to-text errors in the new dictation, following these specific transcription rules:
    - Transcribe "few" exactly as "few", not "a few".
    - Replace the dictated word "query" with a question mark symbol "?".
    - Transcribe "status post" as the abbreviation "S/p".
    - Format dictated dimensions like "8 mm into 9 mm" as "8 x 9 mm".
    - For comparative phrases like "right more than left", use the format "(R > L)". Similarly, for "left more than right", use "(L > R)".
    - Abbreviate "complaints of" to "C/o".
    - Abbreviate "history of" to "H/o".
- Your final output must be ONLY the modified text, with no additional commentary, introductions, or explanations. Do not use any markdown formatting.

Existing Finding:
"${originalText}"

Now, listen to the audio and provide the single, updated finding text.`;

  if (customPrompt) {
    prompt += `\n\nAdditionally, follow these custom instructions:\n${customPrompt}`;
  }

  const textPart = { text: prompt };
  const audioPart = {
    inlineData: {
      mimeType: getCleanMimeType(audioBlob),
      data: base64Audio,
    },
  };

  try {
    const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, audioPart] },
    }));

    const resultText = response.text?.trim();
    if (!resultText) {
      throw new Error("API returned an empty response for finding modification.");
    }
    return resultText;
  } catch (error) {
    console.error("Error calling Gemini API for finding modification:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to process finding modification: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for finding modification.");
  }
};

export const modifyReportWithAudio = async (currentFindings: string[], audioBlob: Blob, model: string, customPrompt?: string): Promise<string[]> => {
  const ai = getAIClient();
  const base64Audio = await blobToBase64(audioBlob);

  let prompt = `You are an expert medical transcriptionist assistant. You are given an existing medical report in JSON format and an audio recording containing instructions to modify it. Your task is to intelligently interpret the audio instructions and return a single, updated report in the exact same JSON format.

**Core Instructions:**

1.  **Preserve by Default:** Your primary goal is to modify the existing report. **You MUST preserve all original findings unless the audio instruction explicitly tells you to remove, replace, or merge them.** Do not discard existing information.

2.  **Formatting for Boldness**:
    *   **Adding New Findings**: When the audio instruction is to add a new clinical finding (e.g., "Add a finding: There is a small lesion..."), you MUST prefix the new finding string with the special marker \`BOLD::\`.
    *   **Preserving Existing Boldness**: When editing an existing finding, if the original finding in the JSON already starts with \`BOLD::\`, the modified finding MUST also start with \`BOLD::\`. If the original did not have the prefix, do not add it.
    *   **Exceptions**: Do NOT add the \`BOLD::\` prefix to the "Clinical Profile" string or the "IMPRESSION" string, as they have their own special formatting rules.

3.  **Interpret Instructions Accurately:** Carefully listen to the audio to understand the user's intent. Instructions can be about:
    *   **Editing:** "Change 'normal' to 'unremarkable' everywhere."
    *   **Removing:** "Remove the sentence about the bony structures."
    *   **Adding:** "Add a new finding: The patient has a history of hypertension." (This will be a new line with the \`BOLD::\` prefix).
    *   **Reordering:** "Move the lung findings to the top."
    *   **Synthesizing/Summarizing:** "Create an impression based on the findings." or "Summarize the key findings."

4.  **Impression Generation and Formatting:** If an audio instruction involves creating, generating, or modifying an "IMPRESSION", you MUST follow these rules:
    *   **Generation from Findings:** If asked to generate an impression from the findings, first analyze the entire report. Then, formulate the new impression points based on these strict criteria:
        *   Impressions must be concise and formulated without using verbs (e.g., "Patches of contusion" instead of "There are patches of contusion").
        *   Combine multiple related findings, including all their key descriptors (like diffusion restriction, enhancement patterns, etc.), into single, coherent impression points to ensure the summary is both concise and complete.
        *   List unrelated findings (e.g., hepatomegaly and splenomegaly) as separate points.
        *   Impressions must NOT contain any numerical values or measurements.
        *   If clinically relevant, you may add concluding phrases like "likely infective etiology" or "likely inflammatory etiology" or "likely neoplastic etiology” or “likely reactive” or “suggested clinical correlation/ review as indicated” or similar phrases. Avoid vague, non-committal conclusions when a more specific diagnosis is possible.
    *   **Formatting:** The entire impression MUST be a single string in the "findings" array. It must start with "IMPRESSION:" (all caps), followed by '###', then each point separated by '###'.
    *   **Adding/Replacing:** Add the newly generated impression as the last finding. If an impression already exists, replace it with the new one.

5.  **Special Clinical Profile Formatting:** If a clinical profile is present, added, or modified, it MUST be a single string that starts with "Clinical Profile:" and is wrapped in single asterisks (e.g., "*Clinical Profile: ...*").

6.  **Format Output Correctly:**
    *   Your final output must be ONLY the modified report, in the same JSON object format as the original, with a key named "findings" whose value is an array of strings.
    *   Do not add any commentary, explanations, or markdown formatting (like \`\`\`json).
    *   Correct any speech-to-text errors from the instruction audio itself before applying the changes, following these rules:
        - Abbreviate "complaints of" to "C/o".
        - Abbreviate "history of" to "H/o".

**Example Scenario:**

*   **Existing Report Input:**
    \`\`\`json
    {
      "findings": [
        "The cardiomediastinal silhouette is within normal limits.",
        "Lungs are clear without evidence of focal consolidation."
      ]
    }
    \`\`\`
*   **Audio Instruction:** "Create an impression: No acute abnormalities."
*   **Correct JSON Output:**
    \`\`\`json
    {
      "findings": [
        "The cardiomediastinal silhouette is within normal limits.",
        "Lungs are clear without evidence of focal consolidation.",
        "IMPRESSION:###No acute abnormalities."
      ]
    }
    \`\`\`
*   **Audio Instruction (Multi-Point):** "Create an impression. First point, hepatomegaly. Second point, splenomegaly."
*   **Correct JSON Output (replaces any existing impression):**
    \`\`\`json
    {
      "findings": [
        "The cardiomediastinal silhouette is within normal limits.",
        "Lungs are clear without evidence of focal consolidation.",
        "IMPRESSION:###Hepatomegaly.###Splenomegaly."
      ]
    }
    \`\`\`

**Existing Report:**
${JSON.stringify({ findings: currentFindings })}
`;

  if (customPrompt) {
    prompt += `\n\nAdditionally, follow these custom instructions when processing the request:\n${customPrompt}`;
  }

  const textPart = { text: prompt };
  const audioPart = {
    inlineData: {
      mimeType: getCleanMimeType(audioBlob),
      data: base64Audio,
    },
  };
  
  try {
    const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
      model: model,
      contents: { parts: [textPart, audioPart] },
      config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
      }
    }));

    const jsonString = response.text;
    if (!jsonString) {
      throw new Error("API returned an empty response for report modification.");
    }

    const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleanedJsonString);

    if (result && Array.isArray(result.findings)) {
      return result.findings;
    } else {
      throw new Error("Invalid data structure in API response. Expected a 'findings' array.");
    }
  } catch (error) {
    console.error("Error calling Gemini API for report modification:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to modify report: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for report modification.");
  }
};

export const transcribeAudioForPrompt = async (audioBlob: Blob): Promise<string> => {
  const ai = getAIClient();
  const base64Audio = await blobToBase64(audioBlob);

  const prompt = "Transcribe the following audio accurately. Provide only the transcribed text without any additional commentary or introduction.";

  const textPart = { text: prompt };
  const audioPart = {
    inlineData: {
      mimeType: getCleanMimeType(audioBlob),
      data: base64Audio,
    },
  };
  
  try {
    const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, audioPart] },
    }));

    const resultText = response.text?.trim();
    if (!resultText) {
      return ""; // Return empty string if no transcription
    }
    return resultText;
  } catch (error) {
    console.error("Error calling Gemini API for transcription:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for transcription.");
  }
};


export const createChat = async (audioBlob: Blob, initialFindings: string[], customPrompt?: string): Promise<Chat> => {
  const ai = getAIClient();
  const base64Audio = await blobToBase64(audioBlob);
  
  const userMessageParts = [
    {
      inlineData: {
        mimeType: getCleanMimeType(audioBlob),
        data: base64Audio,
      },
    },
    {
      text: `This is the audio I dictated.`,
    }
  ];

  const modelResponsePart = { text: `This is the transcript you requested:\n\n${initialFindings.join('\n\n')}` };

  let systemInstruction = 'You are a helpful AI assistant for a radiologist. The user has provided an audio dictation and you have transcribed it. Now, answer the user\'s follow-up questions based on the content of the audio and the transcript.';
  if (customPrompt) {
      systemInstruction += `\n\nAdditionally, follow these custom instructions from the user:\n${customPrompt}`;
  }

  const chat = ai.chats.create({
    model: 'gemini-2.5-pro',
    config: {
      systemInstruction: systemInstruction,
    },
    history: [
      { role: 'user', parts: userMessageParts },
      { role: 'model', parts: [modelResponsePart] },
    ],
  });
  return chat;
};

export const createChatFromText = async (initialFindings: string[], customPrompt?: string): Promise<Chat> => {
  const ai = getAIClient();
  const userMessagePart = { text: `This is the transcript I generated.` };
  const modelResponsePart = { text: `This is the transcript you requested:\n\n${initialFindings.join('\n\n')}` };
  
  let systemInstruction = 'You are a helpful AI assistant for a radiologist. The user has provided a transcript from a live dictation. Now, answer the user\'s follow-up questions based on the content of the transcript.';
  if (customPrompt) {
      systemInstruction += `\n\nAdditionally, follow these custom instructions from the user:\n${customPrompt}`;
  }

  const chat = ai.chats.create({
    model: 'gemini-2.5-pro',
    config: {
      systemInstruction: systemInstruction,
    },
    history: [
      { role: 'user', parts: [userMessagePart] },
      { role: 'model', parts: [modelResponsePart] },
    ],
  });
  return chat;
};

const errorSchema = {
    type: Type.OBJECT,
    properties: {
        errors: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    findingIndex: {
                        type: Type.INTEGER,
                        description: "The 0-based index of the finding with a potential error."
                    },
                    errorDescription: {
                        type: Type.STRING,
                        description: "A concise explanation of the potential error."
                    },
                    severity: {
                        type: Type.STRING,
                        description: "The severity of the issue: 'WARNING' or 'INFO'."
                    }
                },
                required: ["findingIndex", "errorDescription", "severity"]
            }
        }
    }
};

export const identifyPotentialErrors = async (findings: string[], model: string): Promise<IdentifiedError[]> => {
    const ai = getAIClient();
    const textPart = {
        text: `${ERROR_IDENTIFIER_PROMPT}\n\nReport to analyze:\n${JSON.stringify({ findings })}`,
    };

    try {
        const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
            model: model, // use the same model as the main transcription for consistency
            contents: { parts: [textPart] },
            config: {
                responseMimeType: "application/json",
                responseSchema: errorSchema
            }
        }));

        const jsonString = response.text;
        if (!jsonString) {
            return [];
        }

        const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
        const result = JSON.parse(cleanedJsonString);

        if (result && Array.isArray(result.errors)) {
            return result.errors as IdentifiedError[];
        } else {
            console.warn("Invalid data structure in error identification response.");
            return [];
        }
    } catch (error) {
        console.error("Error calling Gemini API for error identification:", error);
        // Don't throw, just return empty array as this is a background task.
        return [];
    }
};

export async function runAgenticAnalysis(content: string): Promise<{ finalResult: string; agenticSteps: string; enhancementText: string; }> {
    const ai = getAIClient();
    let agenticSteps = "### Agentic Workflow Log\n\n";
    let initialAnalyses: string[] = [];
    let refinedAnalyses: string[] = [];
    const DELAY_MS = 250; // Delay for sequential fallback

    try {
        // --- PRIMARY PATH: PARALLEL EXECUTION ---
        agenticSteps += "--- ATTEMPTING PARALLEL EXECUTION ---\n\n";
        
        // Step 1: Parallel Initial Analysis
        agenticSteps += "--- STEP 1: Initial Analysis (Fact-Checker Agents) ---\n\n";
        const initialPromises = Array.from({ length: 3 }, () => 
            retryOperation(() => ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: `${INITIAL_AGENT_PROMPT}\n\n--- CONTENT TO ANALYZE ---\n\n${content}`,
                config: { tools: [{ googleSearch: {} }] }
            }))
        );
        const initialResponses = await Promise.all(initialPromises);
        initialAnalyses = initialResponses.map(res => res.text as string);
        initialAnalyses.forEach((text, i) => {
            agenticSteps += `**Agent 1.${i + 1} Output:**\n\`\`\`\n${text}\n\`\`\`\n\n`;
        });

        // Step 2: Parallel Refinement
        agenticSteps += "--- STEP 2: Refinement (Peer Reviewer Agents) ---\n\n";
        const refinementPromises = initialAnalyses.map(analysis => 
            retryOperation(() => ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: `${REFINEMENT_AGENT_PROMPT}\n\n--- ORIGINAL CONTENT ---\n\n${content}\n\n--- INITIAL ANALYSIS TO REFINE ---\n\n${analysis}`,
                config: { tools: [{ googleSearch: {} }] }
            }))
        );
        const refinedResponses = await Promise.all(refinementPromises);
        refinedAnalyses = refinedResponses.map(res => res.text as string);
        refinedAnalyses.forEach((text, i) => {
            agenticSteps += `**Agent 2.${i + 1} Output:**\n\`\`\`\n${text}\n\`\`\`\n\n`;
        });

    } catch (err) {
        // --- FALLBACK PATH: SEQUENTIAL EXECUTION ---
        const isRateLimitError = err instanceof Error && (err.message.includes('429') || /rate limit/i.test(err.message));
        
        if (isRateLimitError) {
            agenticSteps += "\n---!! PARALLEL EXECUTION FAILED DUE TO RATE LIMITING !! ---\n";
            agenticSteps += `---!! SWITCHING TO SEQUENTIAL EXECUTION WITH DELAYS !! ---\n\n`;
            
            // Wait a moment before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Clear previous results before retry
            initialAnalyses = [];
            refinedAnalyses = [];

            // Step 1: Sequential Initial Analysis
            agenticSteps += "--- STEP 1: Initial Analysis (Fact-Checker Agents) [SEQUENTIAL] ---\n\n";
            for (let i = 0; i < 3; i++) {
                const response = await retryOperation(() => ai.models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: `${INITIAL_AGENT_PROMPT}\n\n--- CONTENT TO ANALYZE ---\n\n${content}`,
                    config: { tools: [{ googleSearch: {} }] }
                }));
                initialAnalyses.push(response.text as string);
                agenticSteps += `**Agent 1.${i + 1} Output:**\n\`\`\`\n${response.text}\n\`\`\`\n\n`;
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }

            // Step 2: Sequential Refinement
            agenticSteps += "--- STEP 2: Refinement (Peer Reviewer Agents) [SEQUENTIAL] ---\n\n";
            for (let i = 0; i < initialAnalyses.length; i++) {
                const analysis = initialAnalyses[i];
                const response = await retryOperation(() => ai.models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: `${REFINEMENT_AGENT_PROMPT}\n\n--- ORIGINAL CONTENT ---\n\n${content}\n\n--- INITIAL ANALYSIS TO REFINE ---\n\n${analysis}`,
                    config: { tools: [{ googleSearch: {} }] }
                }));
                refinedAnalyses.push(response.text as string);
                agenticSteps += `**Agent 2.${i + 1} Output:**\n\`\`\`\n${response.text}\n\`\`\`\n\n`;
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        } else {
            // It's not a rate limit error, so fail the workflow
            console.error("Agentic analysis failed:", err);
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during agentic analysis.";
            agenticSteps += `\n---!! WORKFLOW FAILED !! ---\n${errorMessage}`;
            return {
                finalResult: `${content}\n\n**Error:** The agentic analysis failed. Please try again.`,
                agenticSteps,
                enhancementText: `**Error:** The agentic analysis failed. ${errorMessage}`
            };
        }
    }

    // This part runs after either parallel success or sequential fallback success
    try {
        // Step 3: Final Synthesis
        agenticSteps += "--- STEP 3: Final Synthesis (Master Editor Agent) ---\n\n";
        const synthesizerResponse = await retryOperation(() => ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: `${SYNTHESIZER_AGENT_PROMPT}\n\n--- ORIGINAL CONTENT ---\n\n${content}\n\n--- REFINED ANALYSES ---\n\n${refinedAnalyses.join('\n\n---\n\n')}`,
            config: {
                tools: [{ googleSearch: {} }]
            }
        }));
        const enhancementText = synthesizerResponse.text as string;
        agenticSteps += `**Agent 3.1 (Synthesizer) Output:**\n\`\`\`\n${enhancementText}\n\`\`\`\n\n`;

        // Output Formatting
        let finalResult = '';
        if (enhancementText.toLowerCase().includes("no significant errors or omissions found")) {
            finalResult = content;
        } else {
            let sourcesText = '';
            const groundingChunks = synthesizerResponse.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (groundingChunks && groundingChunks.length > 0) {
                const urls = new Set<string>();
                groundingChunks.forEach(chunk => {
                    if (chunk.web?.uri) {
                        urls.add(chunk.web.uri);
                    }
                });
                if (urls.size > 0) {
                    sourcesText = `\n\n## Sources\n${Array.from(urls).map(url => `- ${url}`).join('\n')}`;
                }
            }
            finalResult = `${content}\n\n${enhancementText}${sourcesText}`;
        }

        return { finalResult, agenticSteps, enhancementText };
    } catch (err) {
        // This catch handles errors during the synthesis step or if the sequential fallback also fails
        console.error("Agentic analysis failed (post-parallel/sequential):", err);
        const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during the final synthesis step.";
        agenticSteps += `\n---!! WORKFLOW FAILED !! ---\n${errorMessage}`;
        return {
            finalResult: `${content}\n\n**Error:** The agentic analysis failed. Please try again.`,
            agenticSteps,
            enhancementText: `**Error:** The agentic analysis failed. ${errorMessage}`
        };
    }
}

export async function runComplexImpressionGeneration(currentFindings: string[], additionalFindings: string): Promise<{ findings: string[]; expertNotes: string; }> {
    const ai = getAIClient();
    const content = currentFindings.join('\n\n') + (additionalFindings ? `\n\n${additionalFindings}` : '');

    const { finalResult: expertNotesContent, enhancementText } = await runAgenticAnalysis(content);

    const findingsWithoutImpression = currentFindings.filter(f => !f.toUpperCase().startsWith('IMPRESSION:'));

    const impressionPrompt = `You are an expert radiologist AI. You are given a set of findings from a dictation and some expert notes from an analysis agent. Your task is to generate a concise, clinically relevant impression based on ALL available information.

**STRICT INSTRUCTIONS:**
1.  **DO NOT MODIFY THE ORIGINAL FINDINGS.** Preserve them exactly as they are provided below.
2.  Use the "Expert Notes" as a knowledge base to deeply understand the context, potential inaccuracies, and missing information. Use this deeper understanding to create a highly accurate and comprehensive impression based on the original findings.
3.  Synthesize a new impression based on the findings. If an impression already exists in the original findings, you MUST REPLACE it with your new one.
4.  Formulate the impression based on these strict criteria:
    - The impression must be concise and formulated without using verbs. For instance, instead of "There are patches of contusion", write "Patches of contusion".
    - Combine multiple related findings, including all their key descriptors into single, coherent impression points to ensure the summary is both concise and complete.
    - List unrelated findings as separate points. For example, hepatomegaly and splenomegaly should be separate points if not related to a primary diagnosis.
    - The impression must NOT contain any numerical values or measurements.
    -  If clinically relevant, you may add concluding phrases like "likely infective etiology" or "likely inflammatory etiology" or "likely neoplastic etiology” or “likely reactive” or “suggested clinical correlation/ review as indicated” or similar phrases. Avoid vague, non-committal conclusions when a more specific diagnosis is possible.
5.  The entire impression MUST be formatted as a single string in the "findings" array. It must start with "IMPRESSION:" (all caps), followed by '###', then each point separated by '###'.
6.  Your final output must be a JSON object with a single key "findings", containing the complete, updated list of findings (original findings + your new impression) as an array of strings.

**ORIGINAL FINDINGS (DO NOT CHANGE):**
${JSON.stringify(findingsWithoutImpression)}

**EXPERT NOTES (USE FOR CONTEXT):**
${expertNotesContent}

Now, generate the complete report including the new impression in the specified JSON format.`;

    const response = await retryOperation(() => ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: impressionPrompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        }
    }));

    const jsonString = response.text;
    if (!jsonString) {
        throw new Error("Complex impression generation returned an empty response.");
    }

    const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleanedJsonString);

    if (result && Array.isArray(result.findings)) {
        return { findings: result.findings, expertNotes: enhancementText };
    } else {
        throw new Error("Invalid data structure in complex impression response.");
    }
}
