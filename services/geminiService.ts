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

const runImageAgenticAnalysis = async (imageBlobs: Blob[], model: string): Promise<string[]> => {
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
            // Use the selected model exclusively
            // FIX: Added GenerateContentResponse type parameter to retryOperation
            const result = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
                model: model,
                contents: { parts: [textPart, imagePart] }
            }));
            if (result.text) transcriptions.push(result.text);
        } catch (error: any) {
            console.error(`Model ${model} failed for image transcription:`, error);
            // Continue to next image even if one fails
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
    // Try synthesis with selected model
    try {
        // FIX: Added GenerateContentResponse type parameter to retryOperation
        synthesizerResponse = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
            model: model,
            contents: { parts: [{ text: synthesizerPrompt }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        }));
    } catch (error: any) {
        // Just throw if synthesizer fails, as we need the result
        throw error;
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
      return await runImageAgenticAnalysis(imageBlobs, model);
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
        throw new Error(`Failed to process report modification: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for report modification.");
  }
};

export const createChat = async (audioBlob: Blob, findings: string[], customPrompt?: string): Promise<Chat> => {
    const ai = getAIClient();
    const base64Audio = await blobToBase64(audioBlob);
    
    // Initialize chat with the context of the current session
    const history = [
        {
            role: "user",
            parts: [
                { text: `Here is the audio recording of the dictation.` },
                {
                    inlineData: {
                        mimeType: getCleanMimeType(audioBlob),
                        data: base64Audio
                    }
                },
                { text: `And here are the corrected findings you generated from it:\n${JSON.stringify(findings, null, 2)}\n\nI might ask you follow-up questions about this report or the audio.` }
            ]
        },
        {
            role: "model",
            parts: [{ text: "Understood. I have the audio and the findings. I am ready to answer your questions." }]
        }
    ];

    const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        history: history,
        config: {
            systemInstruction: customPrompt || DEFAULT_GEMINI_PROMPT
        }
    });

    return chat;
};

export const createChatFromText = async (findings: string[], customPrompt?: string): Promise<Chat> => {
     const ai = getAIClient();
     
     const history = [
         {
             role: "user",
             parts: [
                 { text: `Here are the radiology findings:\n${JSON.stringify(findings, null, 2)}\n\nI might ask you follow-up questions about this report.` }
             ]
         },
         {
             role: "model",
             parts: [{ text: "Understood. I have the findings. I am ready to answer your questions." }]
         }
     ];
 
     const chat = ai.chats.create({
         model: 'gemini-2.5-flash',
         history: history,
         config: {
             systemInstruction: customPrompt || DEFAULT_GEMINI_PROMPT
         }
     });
 
     return chat;
 };

export const identifyPotentialErrors = async (findings: string[], model: string): Promise<IdentifiedError[]> => {
    const ai = getAIClient();
    const findingsText = JSON.stringify({ findings });
    
    const prompt = ERROR_IDENTIFIER_PROMPT + "\n\nInput Report:\n" + findingsText;

    try {
        const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
            model: model,
            contents: { parts: [{ text: prompt }] },
            config: {
                responseMimeType: "application/json",
                // responseSchema could be defined but let's stick to prompt instruction for now as the prompt is quite specific about output format
            }
        }));

        const jsonString = response.text;
        if (!jsonString) return [];
        
        const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
        const result = JSON.parse(cleanedJsonString);
        
        if (result && Array.isArray(result.errors)) {
            return result.errors;
        }
        return [];
    } catch (error) {
        console.error("Error identifying potential errors:", error);
        return [];
    }
};

export const transcribeAudioForPrompt = async (audioBlob: Blob): Promise<string> => {
    const ai = getAIClient();
    const base64Audio = await blobToBase64(audioBlob);
    
    const prompt = "Transcribe the following audio exactly as spoken. Do not add any commentary. Do not format it as a medical report, just plain text.";

    try {
        const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    { text: prompt },
                    {
                        inlineData: {
                            mimeType: getCleanMimeType(audioBlob),
                            data: base64Audio
                        }
                    }
                ]
            }
        }));

        return response.text?.trim() || "";
    } catch (error) {
        console.error("Error transcribing audio for prompt:", error);
        throw error;
    }
};

export const runComplexImpressionGeneration = async (findings: string[], complexInput: string): Promise<{ findings: string[], expertNotes: string }> => {
    const ai = getAIClient();
    const findingsText = findings.join('\n');
    const inputContent = `Original Report Findings:\n${findingsText}\n\nAdditional User Notes/Patient History:\n${complexInput}`;

    // Agent 1: Initial Analysis
    let initialAnalysis = "";
    try {
        // FIX: Added GenerateContentResponse type parameter to retryOperation
        const response1 = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: {
                parts: [
                    { text: INITIAL_AGENT_PROMPT },
                    { text: `Here is the case content:\n${inputContent}` }
                ]
            },
            config: {
                tools: [{ googleSearch: {} }] // Use Search Grounding
            }
        }));
        initialAnalysis = response1.text || "";
    } catch (e) {
        console.error("Agent 1 failed", e);
        throw new Error("Initial analysis failed.");
    }

    // Agent 2: Refinement
    let refinedAnalysis = "";
    try {
        // FIX: Added GenerateContentResponse type parameter to retryOperation
        const response2 = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: {
                parts: [
                    { text: REFINEMENT_AGENT_PROMPT },
                    { text: `Original Content:\n${inputContent}\n\nInitial Analysis:\n${initialAnalysis}` }
                ]
            },
            config: {
                 tools: [{ googleSearch: {} }]
            }
        }));
        refinedAnalysis = response2.text || "";
    } catch (e) {
        console.error("Agent 2 failed", e);
        refinedAnalysis = initialAnalysis; // Fallback
    }

    // Agent 3: Synthesis (Expert Notes)
    let expertNotes = "";
    try {
        // FIX: Added GenerateContentResponse type parameter to retryOperation
        const response3 = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: {
                parts: [
                    { text: SYNTHESIZER_AGENT_PROMPT },
                    { text: `Original Content:\n${inputContent}\n\nRefined Analysis:\n${refinedAnalysis}` }
                ]
            },
             config: {
                 tools: [{ googleSearch: {} }]
            }
        }));
        expertNotes = response3.text || "";
    } catch (e) {
         console.error("Agent 3 failed", e);
         expertNotes = refinedAnalysis;
    }

    // Final Step: Generate updated Impression for the report
    let updatedFindings = [...findings];
    try {
        const impressionPrompt = `
        You are an expert radiologist.
        
        Context:
        1. Existing Report Findings: ${JSON.stringify(findings)}
        2. Additional Patient History/Notes: ${complexInput}
        3. Expert Analysis & Research: ${expertNotes}

        Task:
        Based on ALL the above information, generate a comprehensive and clinically accurate IMPRESSION section.
        - Combine related findings.
        - Incorporate the expert analysis where clinically appropriate for the diagnosis.
        - Format the impression as a single string starting with "IMPRESSION:###".
        - Separate points with "###".
        - Do not include the findings list, ONLY the IMPRESSION string.
        `;

        // FIX: Added GenerateContentResponse type parameter to retryOperation
        const response4 = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
             model: 'gemini-2.5-flash',
             contents: { parts: [{ text: impressionPrompt }] }
        }));
        
        const newImpression = response4.text?.trim();
        if (newImpression && newImpression.includes("IMPRESSION:")) {
            // Remove old impression if exists (naive check or matching standard format)
             updatedFindings = updatedFindings.filter(f => {
                const clean = f.replace(/^BOLD::/, '');
                return !clean.includes("IMPRESSION:");
             });

            updatedFindings.push(newImpression);
        }

    } catch (e) {
        console.error("Final impression generation failed", e);
        // If fails, we just return original findings with the notes
    }

    return {
        findings: updatedFindings,
        expertNotes: expertNotes
    };
};
