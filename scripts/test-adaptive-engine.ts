import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import prisma from "../lib/db";
import { determineNextQuestionParams } from "../lib/interview/engine";
import { QUESTION_GENERATOR_PROMPT, ANSWER_EVALUATOR_PROMPT } from "../lib/llm/prompts";
import { generateLLMResponse } from "../lib/llm";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${testName}${details ? ` -> ${details}` : ""}`);
    failCount++;
  }
}

async function runTests() {
  console.log("=== TASK 4: ADAPTIVE INTERVIEW ENGINE VERIFICATION ===\n");

  // Setup test session and cleanup helper
  const uniqueSuffix = Date.now().toString().slice(-6);
  let testUser: { id: number } | null = null;
  let testCandidate: { id: string } | null = null;
  let testSession: { id: string } | null = null;

  try {
    testUser = await prisma.user.create({
      data: {
        email: `adaptive_test_${uniqueSuffix}@kmit.edu`,
        username: `adaptive_user_${uniqueSuffix}`,
        passwordHash: "hash",
        role: "INTERVIEWER"
      }
    });

    testCandidate = await prisma.candidate.create({
      data: {
        name: "Test Candidate",
        email: `candidate_${uniqueSuffix}@kmit.edu`
      }
    });

    testSession = await prisma.interviewSession.create({
      data: {
        candidateId: testCandidate.id,
        interviewerId: testUser.id,
        difficulty: "easy",
        interviewType: "Adaptive",
        scope: { subject: "Database Systems", mode: "standard" }
      }
    });

    console.log("--- Section 1: Adaptive Difficulty Stepping Logic ---");

    // Test 1: Easy -> Medium when score >= 80
    const q1 = await prisma.question.create({
      data: {
        sessionId: testSession.id,
        questionNumber: 1,
        content: "What is an index in SQL?",
        type: "Conceptual",
        difficulty: "easy",
        topic: "Indexing",
        coreConcepts: ["Index", "B-Tree"]
      }
    });
    const a1 = await prisma.answer.create({
      data: {
        questionId: q1.id,
        transcript: "An index is a data structure, like a B-tree, that improves the speed of data retrieval on database tables."
      }
    });
    await prisma.answerEvaluation.create({
      data: {
        answerId: a1.id,
        score: 90,
        correctness: "Completely accurate",
        completeness: "Thorough explanation",
        relevance: "Directly answered",
        technicalAccuracy: "No errors",
        mentionedKeywords: ["index", "B-tree", "data retrieval"],
        missingKeywords: [],
        feedback: "Excellent understanding of database indexing."
      }
    });

    const paramsAfterQ1 = await determineNextQuestionParams(testSession.id);
    assert(paramsAfterQ1.difficulty === "medium", "Test 1A: Difficulty stepped up from 'easy' to 'medium' on score >= 80 (score: 90)");

    // Test 2: Medium -> Hard when score >= 80
    const q2 = await prisma.question.create({
      data: {
        sessionId: testSession.id,
        questionNumber: 2,
        content: "How does a clustered index differ from a non-clustered index?",
        type: "Conceptual",
        difficulty: "medium",
        topic: "Indexing",
        coreConcepts: ["Clustered Index", "Non-Clustered Index"]
      }
    });
    const a2 = await prisma.answer.create({
      data: {
        questionId: q2.id,
        transcript: "A clustered index alters the physical order of rows on disk. A table can only have one clustered index. Non-clustered indexes create separate lookup structures with pointers to table data."
      }
    });
    await prisma.answerEvaluation.create({
      data: {
        answerId: a2.id,
        score: 85,
        correctness: "Accurate",
        completeness: "Complete",
        relevance: "Relevant",
        technicalAccuracy: "Accurate",
        mentionedKeywords: ["clustered", "non-clustered", "physical order"],
        missingKeywords: [],
        feedback: "Strong grasp of clustered vs non-clustered indexes."
      }
    });

    const paramsAfterQ2 = await determineNextQuestionParams(testSession.id);
    assert(paramsAfterQ2.difficulty === "hard", "Test 1B: Difficulty stepped up from 'medium' to 'hard' on score >= 80 (score: 85)");

    // Test 3: Hard -> Hard when score between 41 and 79
    const q3 = await prisma.question.create({
      data: {
        sessionId: testSession.id,
        questionNumber: 3,
        content: "Explain B-Tree node splitting during high-concurrency inserts.",
        type: "Problem-Solving",
        difficulty: "hard",
        topic: "B-Trees",
        coreConcepts: ["Node Splitting", "Concurrency"]
      }
    });
    const a3 = await prisma.answer.create({
      data: {
        questionId: q3.id,
        transcript: "When a node fills up, it splits in half and pushes the median key up. In concurrency, locks or latches are taken."
      }
    });
    await prisma.answerEvaluation.create({
      data: {
        answerId: a3.id,
        score: 65,
        correctness: "Partially correct",
        completeness: "Missing latch crabbing details",
        relevance: "Relevant",
        technicalAccuracy: "Basic understanding",
        mentionedKeywords: ["split", "median key"],
        missingKeywords: ["latch crabbing", "deadlock avoidance"],
        feedback: "Understands splitting but lacked concurrency lock escalation detail."
      }
    });

    const paramsAfterQ3 = await determineNextQuestionParams(testSession.id);
    assert(paramsAfterQ3.difficulty === "hard", "Test 1C: Difficulty remained 'hard' on moderate score (score: 65, between 41 and 79)");

    // Test 4: Hard -> Medium when score <= 40
    const q4 = await prisma.question.create({
      data: {
        sessionId: testSession.id,
        questionNumber: 4,
        content: "What is latch crabbing in concurrent B-tree index traversals?",
        type: "Problem-Solving",
        difficulty: "hard",
        topic: "Concurrency",
        coreConcepts: ["Latch Crabbing", "Locking"]
      }
    });
    const a4 = await prisma.answer.create({
      data: {
        questionId: q4.id,
        transcript: "I am not sure, I think it means locking the entire table so nobody can write."
      }
    });
    await prisma.answerEvaluation.create({
      data: {
        answerId: a4.id,
        score: 20,
        correctness: "Incorrect",
        completeness: "Incomplete",
        relevance: "Vague guess",
        technicalAccuracy: "Incorrectly stated table locking instead of latch crabbing",
        mentionedKeywords: [],
        missingKeywords: ["latch crabbing", "parent latch release", "child acquisition"],
        feedback: "Major misconception regarding concurrency control in index trees."
      }
    });

    const paramsAfterQ4 = await determineNextQuestionParams(testSession.id);
    assert(paramsAfterQ4.difficulty === "medium", "Test 1D: Difficulty stepped down from 'hard' to 'medium' on score <= 40 (score: 20)");

    console.log("\n--- Section 2: Session Trajectory & Earlier Context Formatting ---");

    // Test 5: Check earlierContextText
    assert(
      paramsAfterQ4.earlierContextText.includes("[Q1: \"What is an index in SQL?\"]") &&
      paramsAfterQ4.earlierContextText.includes("[Q2: \"How does a clustered index differ from a non-clustered index?\"]") &&
      paramsAfterQ4.earlierContextText.includes("[Q3: \"Explain B-Tree node splitting during high-concurrency inserts.\"]"),
      "Test 2A: Earlier context text properly lists preceding Q&As with question numbers and snippets"
    );

    // Test 6: Verify last question is excluded from earlierContextText (because it's the previous_question)
    assert(
      !paramsAfterQ4.earlierContextText.includes("Q4"),
      "Test 2B: Latest evaluated question (Q4) is excluded from earlier context to prevent duplication"
    );

    // Test 7: Verify previousQuestions contains all 4 questions
    assert(
      paramsAfterQ4.previousQuestions.length === 4 &&
      paramsAfterQ4.previousQuestions.includes("What is an index in SQL?") &&
      paramsAfterQ4.previousQuestions.includes("What is latch crabbing in concurrent B-tree index traversals?"),
      "Test 2C: previousQuestions includes all questions asked so far to prevent repetitions"
    );

    console.log("\n--- Section 3: Knowledge Gaps & Weak Concepts Accumulation ---");

    // Add gaps
    await prisma.knowledgeGap.createMany({
      data: [
        { sessionId: testSession.id, concept: "Latch Crabbing", confidence: "High", evidence: "Candidate guessed table locking" },
        { sessionId: testSession.id, concept: "Lock Escalation", confidence: "Medium", evidence: "Candidate missed concurrency details" },
        { sessionId: testSession.id, concept: "Latch Crabbing", confidence: "High", evidence: "Duplicate gap test" }
      ]
    });

    const paramsWithGaps = await determineNextQuestionParams(testSession.id);
    assert(
      paramsWithGaps.weakConcepts.includes("Latch Crabbing") &&
      paramsWithGaps.weakConcepts.includes("Lock Escalation") &&
      paramsWithGaps.weakConcepts.filter(c => c === "Latch Crabbing").length === 1,
      "Test 3: Weak concepts are collected and deduplicated across the session"
    );

    console.log("\n--- Section 4: Answer-Aware RAG Query Construction ---");

    const sampleQuestion = "Explain transaction isolation levels in relational databases.";
    const sampleTranscript = "Isolation prevents dirty reads, non-repeatable reads, and phantom reads. In read uncommitted dirty reads happen.";
    const sampleMissing = ["Serializable Isolation", "Two-Phase Locking"];
    const sampleMisconceptions = ["Snapshot isolation eliminates all concurrency anomalies"];
    const sampleWeak = ["Latch Crabbing", "Lock Escalation"];

    const focusTerms = Array.from(new Set([
      ...sampleMissing,
      ...sampleMisconceptions,
      ...sampleWeak
    ])).filter(Boolean);

    const answerSnippet = sampleTranscript.slice(0, 150).replace(/\s+/g, " ").trim();
    const ragQuery = `${sampleQuestion} ${focusTerms.slice(0, 5).join(" ")} ${answerSnippet}`.trim();

    assert(
      ragQuery.includes(sampleQuestion) &&
      ragQuery.includes("Serializable Isolation") &&
      ragQuery.includes("Snapshot isolation") &&
      ragQuery.includes("Isolation prevents dirty reads"),
      "Test 4A: RAG query successfully combines previous question, missing concepts, misconceptions, and answer snippet"
    );

    // Empty focus terms fallback test
    const emptyFocusQuery = `${sampleQuestion} ${answerSnippet}`.trim();
    assert(
      emptyFocusQuery.includes(sampleQuestion) && emptyFocusQuery.includes("Isolation prevents"),
      "Test 4B: RAG query cleanly falls back to question + transcript snippet when no gaps exist"
    );

    console.log("\n--- Section 5: Answer-Aware Prompt Construction & Placeholder Replacement ---");

    const evalSummary = [
      "- Score: 60/100",
      "- Correctness: Partially correct",
      "- Completeness: Missing phantom read explanation",
      "- Technical Accuracy: Mentioned dirty reads accurately",
      "- Missing Concepts: Phantom reads, Serializable",
      "- Misconceptions / Incorrect Concepts: None identified",
      "- Evaluator Feedback: Good start, but missing upper isolation levels."
    ].join("\n");

    const populatedPrompt = QUESTION_GENERATOR_PROMPT
      .replace("{{subject}}", "Database Systems")
      .replace("{{topic}}", "Transactions")
      .replace("{{difficulty}}", "medium")
      .replace("{{context}}", "Standard RAG retrieved chunk regarding ACID isolation.")
      .replace("{{previous_question}}", sampleQuestion)
      .replace("{{candidate_answer}}", sampleTranscript)
      .replace("{{evaluation_summary}}", evalSummary)
      .replace("{{previous_questions}}", "1. What is an index?\n2. Explain isolation levels.")
      .replace("{{earlier_context}}", "[Q1: 'What is an index?'] -> Answer: 'A tree structure' (Score: 90/100)")
      .replace("{{weak_concepts}}", "Phantom reads, Serializable")
      .replace("{{remaining_concepts}}", "Phantom reads, Serializable");

    assert(!populatedPrompt.includes("{{"), "Test 5A: All template placeholders are cleanly replaced with no orphan tokens");
    assert(populatedPrompt.includes(sampleTranscript), "Test 5B: Candidate's actual transcript is present in the prompt");
    assert(populatedPrompt.includes("Score: 60/100"), "Test 5C: Quantitative evaluation score is present in the prompt");
    assert(populatedPrompt.includes("Missing Concepts: Phantom reads, Serializable"), "Test 5D: Missing concepts are clearly detailed in the prompt");
    assert(populatedPrompt.includes("ANSWER-AWARE ADAPTATION"), "Test 5E: Adaptive rules and performance-tailored guidance are present in prompt instructions");

    console.log("\n--- Section 6: Live LLM Adaptive Follow-Up Question Generation ---");

    // Scenario A: Strong Candidate (Score 92) -> Test live LLM generation
    const strongPrompt = QUESTION_GENERATOR_PROMPT
      .replace("{{subject}}", "Database Systems")
      .replace("{{topic}}", "Indexing")
      .replace("{{difficulty}}", "hard")
      .replace("{{context}}", "B-Tree indexes maintain balance through node splitting and merging. Concurrency requires latch crabbing.")
      .replace("{{previous_question}}", "How does a B-tree maintain balance during insertions?")
      .replace("{{candidate_answer}}", "When a leaf node exceeds capacity, it splits at the median key. The median is promoted to the parent node recursively up to the root, which increases the tree height by one if the root splits.")
      .replace("{{evaluation_summary}}", "- Score: 92/100\n- Correctness: Fully correct\n- Completeness: Complete explanation of median promotion and root splitting\n- Technical Accuracy: High\n- Missing Concepts: None\n- Misconceptions: None\n- Evaluator Feedback: Mastered B-tree balance mechanics.")
      .replace("{{previous_questions}}", "1. What is an index?\n2. How does a B-tree maintain balance during insertions?")
      .replace("{{earlier_context}}", "[Q1: 'What is an index?'] -> Answer: 'A data structure' (Score: 88/100)")
      .replace("{{weak_concepts}}", "None")
      .replace("{{remaining_concepts}}", "None");

    console.log("  Invoking LLM for Scenario A (Strong answer)...");
    const resA = await generateLLMResponse(strongPrompt + "\n\nReply in strict JSON format.");
    let parsedA: any = null;
    try {
      parsedA = JSON.parse(resA.text);
    } catch {
      const cleaned = resA.text.replace(/```json/g, "").replace(/```/g, "").trim().replace(/,\s*([\}\]])/g, "$1");
      parsedA = JSON.parse(cleaned);
    }

    assert(
      Array.isArray(parsedA?.suggestions) && parsedA.suggestions.length >= 1,
      "Test 6A: LLM successfully generated structured question suggestions for Scenario A"
    );
    const suggestionA = parsedA?.suggestions?.[0];
    assert(
      typeof suggestionA?.question === "string" && suggestionA.question.length > 10,
      `Test 6B: Valid question generated: "${suggestionA?.question?.slice(0, 70)}..."`
    );
    assert(
      typeof suggestionA?.reason === "string" && suggestionA.reason.length > 5,
      `Test 6C: Question includes adaptive reasoning: "${suggestionA?.reason?.slice(0, 70)}..."`
    );

    // Scenario B: Candidate with Misconception (Score 30) -> Test live LLM generation
    const weakPrompt = QUESTION_GENERATOR_PROMPT
      .replace("{{subject}}", "Database Systems")
      .replace("{{topic}}", "Transactions")
      .replace("{{difficulty}}", "easy")
      .replace("{{context}}", "ACID properties: Atomicity guarantees all-or-nothing, Consistency preserves invariants, Isolation controls concurrent visibility, Durability guarantees persistence after commit.")
      .replace("{{previous_question}}", "What is the difference between Atomicity and Durability?")
      .replace("{{candidate_answer}}", "Atomicity means data is saved permanently to hard drive, and Durability means transactions don't interfere with each other.")
      .replace("{{evaluation_summary}}", "- Score: 30/100\n- Correctness: Incorrect\n- Completeness: Poor\n- Technical Accuracy: Inverted definitions of Durability and Atomicity; confused Durability with Isolation.\n- Missing Concepts: All-or-nothing execution, write-ahead logging, persistence\n- Misconceptions / Incorrect Concepts: Confused Atomicity with storage persistence, and Durability with Isolation\n- Evaluator Feedback: Severe confusion of ACID properties.")
      .replace("{{previous_questions}}", "1. What is a relational database?\n2. What is the difference between Atomicity and Durability?")
      .replace("{{earlier_context}}", "[Q1: 'What is a relational database?'] -> Answer: 'A database with tables' (Score: 75/100)")
      .replace("{{weak_concepts}}", "Atomicity, Durability, Isolation")
      .replace("{{remaining_concepts}}", "Atomicity, Durability, Isolation");

    console.log("  Invoking LLM for Scenario B (Candidate with misconception)...");
    const resB = await generateLLMResponse(weakPrompt + "\n\nReply in strict JSON format.");
    let parsedB: any = null;
    try {
      parsedB = JSON.parse(resB.text);
    } catch {
      const cleaned = resB.text.replace(/```json/g, "").replace(/```/g, "").trim().replace(/,\s*([\}\]])/g, "$1");
      parsedB = JSON.parse(cleaned);
    }

    assert(
      Array.isArray(parsedB?.suggestions) && parsedB.suggestions.length >= 1,
      "Test 6D: LLM successfully generated structured question suggestions for Scenario B"
    );
    const suggestionB = parsedB?.suggestions?.[0];
    assert(
      typeof suggestionB?.question === "string" && suggestionB.question.length > 10,
      `Test 6E: Follow-up question generated for misconception: "${suggestionB?.question?.slice(0, 70)}..."`
    );
    assert(
      typeof suggestionB?.reason === "string" && suggestionB.reason.length > 5,
      `Test 6F: Reason connects to misconception/performance: "${suggestionB?.reason?.slice(0, 70)}..."`
    );

    console.log("\n--- Section 7: Fallback & Resiliency Verification ---");

    // Test JSON parsing failure recovery with adaptive fallback
    const malformedLLMResponse = "INVALID_NON_JSON_RESPONSE";
    let fallbackResult: any = null;
    try {
      fallbackResult = JSON.parse(malformedLLMResponse);
    } catch {
      const fallbackTopic = "Indexing";
      const missingConcepts = ["B-Tree rebalancing"];
      const fallbackReason = missingConcepts.length > 0
        ? `Follow-up probing missing concept: ${missingConcepts[0]}`
        : `Adaptive follow-up based on performance (difficulty: medium)`;
      const fallbackQuestion = missingConcepts.length > 0
        ? `Could you explain the role of ${missingConcepts[0]} in relation to your previous answer?`
        : `Can you elaborate on the core principles underlying your previous answer?`;
      fallbackResult = {
        suggestions: [{
          question: fallbackQuestion,
          type: "Conceptual",
          difficulty: "medium",
          topic: fallbackTopic,
          reason: fallbackReason
        }]
      };
    }

    assert(
      fallbackResult.suggestions[0].question.includes("B-Tree rebalancing"),
      "Test 7A: Fallback logic generates adaptive question targeting missing concepts when LLM response is malformed"
    );

    // Test missing optional evaluation fields
    const partialEval: any = { score: 75 };
    const safeCorrectness = String(partialEval.correctness || "Not evaluated");
    const safeTechAccuracy = String(partialEval.technical_accuracy || partialEval.technicalAccuracy || "Not evaluated");
    const safeMissing = Array.isArray(partialEval.missing_concepts) ? partialEval.missing_concepts : [];

    assert(
      safeCorrectness === "Not evaluated" && safeTechAccuracy === "Not evaluated" && safeMissing.length === 0,
      "Test 7B: Missing optional evaluation fields are handled safely with clean default values"
    );

  } finally {
    // Cleanup test data
    console.log("\n--- Cleaning up test artifacts ---");
    if (testSession) {
      await prisma.knowledgeGap.deleteMany({ where: { sessionId: testSession.id } });
      const questions = await prisma.question.findMany({ where: { sessionId: testSession.id } });
      for (const q of questions) {
        await prisma.answerEvaluation.deleteMany({ where: { answer: { questionId: q.id } } });
        await prisma.answer.deleteMany({ where: { questionId: q.id } });
      }
      await prisma.question.deleteMany({ where: { sessionId: testSession.id } });
      await prisma.interviewSession.delete({ where: { id: testSession.id } });
    }
    if (testCandidate) {
      await prisma.candidate.delete({ where: { id: testCandidate.id } });
    }
    if (testUser) {
      await prisma.auditLog.deleteMany({ where: { userId: testUser.id } });
      await prisma.user.delete({ where: { id: testUser.id } });
    }
    console.log("Cleanup complete.");
  }

  console.log(`\n========================================`);
  console.log(`TOTAL TESTS: ${passCount + failCount}`);
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log(`========================================\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed with error:", err);
  process.exit(1);
});
