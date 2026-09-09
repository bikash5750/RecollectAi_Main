import { GoogleGenerativeAI } from "@google/generative-ai";

let genAICached = null;
let apiKeyCached = null;

const getGeminiApiKey = () => {
  const raw = process.env.GEMINI_API_KEY;
  const key = typeof raw === "string" ? raw.trim() : "";

  // Guard against accidentally passing literal strings from misconfigured envs
  if (
    !key ||
    key.toLowerCase() === "undefined" ||
    key.toLowerCase() === "null"
  ) {
    throw new Error(
      "GEMINI_API_KEY is not set (check backend/.env and server startup)",
    );
  }

  return key;
};

const getGenAI = () => {
  const key = getGeminiApiKey();

  // If key changes at runtime, re-init the client
  if (!genAICached || apiKeyCached !== key) {
    apiKeyCached = key;
    genAICached = new GoogleGenerativeAI(key);
  }

  return genAICached;
};

// Transcribe audio using Gemini
export const transcribeAudio = async (audioBuffer, mimeType) => {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

    const prompt = `Transcribe the following audio accurately. Provide clean, punctuated, and formatted text. Only return the transcription, nothing else.`;

    const audioPart = {
      inlineData: {
        data: audioBuffer.toString("base64"),
        mimeType: mimeType,
      },
    };

    const result = await model.generateContent([prompt, audioPart]);
    const response = await result.response;
    const transcript = response.text();

    return transcript;
  } catch (error) {
    console.error("Gemini transcription error:", error);
    if (
      error instanceof Error &&
      error.message.startsWith("GEMINI_API_KEY is not set")
    ) {
      throw error;
    }
    throw new Error("Failed to transcribe audio");
  }
};

// Process transcript to extract summary, key points, and category
export const processTranscript = async (transcript) => {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

    const prompt = `
Analyze the following transcript from a student's voice note and provide:

1. **Title**: A short, descriptive title (max 8 words)

2. **Summary**: A DETAILED and COMPREHENSIVE summary (4-6 paragraphs)
   - First paragraph: Overview of the main topic/subject
   - Middle paragraphs: Detailed explanation of concepts, examples, and important details
   - Final paragraph: Conclusions, takeaways, or action items
   - Make it thorough and informative - students should be able to review this instead of reading the full transcript

3. **Key Points**: Extract 5-10 bullet points of the most important information
   - Be specific and detailed
   - Include examples or context where mentioned

4. **Category**: Classify into ONE of these categories:
   - Lecture Notes
   - Assignments & Deadlines
   - Exams/Test Reminders
   - Events & Meetups
   - Personal Reflections

5. **Tasks**: Extract any deadlines, assignments, exams, or events with dates. For each task, provide:
   - Task title
   - Due date (in ISO format if possible, otherwise describe the date)
   - Task type (Assignment, Exam, Project, Event, Other)

Return the response in the following JSON format:
{
  "title": "Title here",
  "summary": "Detailed comprehensive summary here (4-6 paragraphs)",
  "keyPoints": ["Point 1", "Point 2", ...],
  "category": "Category name",
  "tasks": [
    {
      "title": "Task title",
      "dueDate": "date description",
      "type": "Assignment"
    }
  ]
}

Transcript:
${transcript}

Return ONLY valid JSON, no additional text.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    // Clean up markdown code blocks if present
    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const analysis = JSON.parse(text);

    return analysis;
  } catch (error) {
    console.error("Gemini processing error:", error);
    if (
      error instanceof Error &&
      error.message.startsWith("GEMINI_API_KEY is not set")
    ) {
      throw error;
    }
    throw new Error("Failed to process transcript");
  }
};

// Detect companion mode keywords in transcript
export const detectKeywords = async (transcript) => {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

    const prompt = `
Analyze the following transcript and detect instances where the speaker used any of these keywords:
- "Important"
- "Write this"
- "Key point"
- "Exam point"
- "Assignment"

For each occurrence, extract:
1. The keyword used
2. The surrounding context (the sentence or phrase before and after the keyword)
3. A brief description of what should be captured

Return the response in JSON format:
{
  "highlights": [
    {
      "keyword": "Important",
      "context": "The surrounding text",
      "description": "What to capture"
    }
  ]
}

Transcript:
${transcript}

Return ONLY valid JSON, no additional text.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    // Clean up markdown code blocks if present
    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const keywordAnalysis = JSON.parse(text);

    return keywordAnalysis.highlights || [];
  } catch (error) {
    console.error("Keyword detection error:", error);
    if (
      error instanceof Error &&
      error.message.startsWith("GEMINI_API_KEY is not set")
    ) {
      throw error;
    }
    return [];
  }
};

export const chatWithMemories = async (
  userMessage,
  allNotes,
  chatHistory = [],
  allTasks = [],
) => {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

    // Build context from notes
    let notesContext = "";
    if (allNotes && allNotes.length > 0) {
      notesContext = allNotes
        .map((note, index) => {
          const date = new Date(note.createdAt).toLocaleDateString();
          return `
[Note ${index + 1}] - ${note.title} (${note.category}) - ${date}
Summary: ${note.summary}
Key Points: ${note.keyPoints ? note.keyPoints.join(", ") : "None"}
Transcript: ${note.transcript.substring(0, 500)}${note.transcript.length > 500 ? "..." : ""}
`;
        })
        .join("\n---\n");
    } else {
      notesContext = "No notes available yet.";
    }

    // Build context from tasks
    let tasksContext = "";
    if (allTasks && allTasks.length > 0) {
      tasksContext = allTasks
        .map((task, index) => {
          const dueDate = new Date(task.dueDate).toLocaleDateString();
          const statusEmoji =
            task.status === "completed"
              ? "✅"
              : task.status === "in_progress"
                ? "🔄"
                : "⏸️";
          return `
[Task ${index + 1}] ${statusEmoji} ${task.title} (${task.category})
Status: ${task.status.replace("_", " ")}
Progress: ${task.progressPercentage}%
Submitted: ${task.submitted ? "Yes" : "No"}
Due: ${dueDate}
${task.description ? `Description: ${task.description}` : ""}
${task.progressNotes && task.progressNotes.length > 0 ? `Latest Note: ${task.progressNotes[task.progressNotes.length - 1].note}` : ""}
`;
        })
        .join("\n---\n");
    } else {
      tasksContext = "No tasks available yet.";
    }

    // Build chat history
    let historyContext = "";
    if (chatHistory && chatHistory.length > 0) {
      historyContext = chatHistory
        .map(
          (msg) =>
            `${msg.role === "user" ? "You" : "Assistant"}: ${msg.message}`,
        )
        .join("\n");
    }

    const prompt = `You are a helpful AI assistant that helps students recall and understand their notes AND track their assignment progress. You have access to all of the user's voice transcripts, summaries, key points, AND task/assignment progress.

Your role:
- Answer questions about the user's notes with detailed responses
- Help them find specific information across all their recordings
- Provide comprehensive summaries when asked about topics
- Track and report on assignment/task progress
- Remind them of important deadlines, key points, and exam materials
- Connect related concepts from different notes
- Be conversational, friendly, and act like a study buddy
- If you don't find relevant information in the notes, say so politely and offer to help in other ways

IMPORTANT - Progress Tracking Commands:
You can detect when users want to update task progress. Look for phrases like:
- "Mark [task name] as [status]" → You should respond with: UPDATE_TASK: {taskId}, status: [status]
- "Set [task name] to [X]%" → You should respond with: UPDATE_TASK: {taskId}, progress: [X]
- "I submitted [task name]" → You should respond with: UPDATE_TASK: {taskId}, submitted: true
- "Add progress note to [task name]: [note]" → You should respond with: UPDATE_TASK: {taskId}, note: [note]

When asked about progress:
- "Show my progress" → List all tasks with their status and percentage
- "What's completed?" → List completed tasks
- "What's pending?" → List not started tasks
- "What am I working on?" → List in-progress tasks

${historyContext ? `Previous conversation:\n${historyContext}\n` : ""}

User's Notes Context:
${notesContext}

User's Tasks/Assignments Context:
${tasksContext}

Current question: ${userMessage}

Provide a helpful, conversational response based on the user's notes and tasks. If referencing specific items, mention their titles. For progress updates, include the UPDATE_TASK command format at the end of your response.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiResponse = response.text();

    return aiResponse;
  } catch (error) {
    console.error("Chat with memories error:", error);
    if (
      error instanceof Error &&
      error.message.startsWith("GEMINI_API_KEY is not set")
    ) {
      throw error;
    }
    throw new Error("Failed to generate chat response");
  }
};

// Parse chat response for task update commands
export const parseTaskUpdateCommand = (aiResponse) => {
  const updateMatch = aiResponse.match(
    /UPDATE_TASK:\s*\{taskId\},\s*(\w+):\s*(.+)/,
  );

  if (updateMatch) {
    const field = updateMatch[1];
    const value = updateMatch[2].trim();

    return {
      hasUpdate: true,
      field,
      value,
    };
  }

  return { hasUpdate: false };
};
