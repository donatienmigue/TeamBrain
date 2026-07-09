import type { ExistingMemory } from './brain-memories.js';

export interface FlywheelExamples {
  accepted: string[];
  rejected: string[];
}

/**
 * Extracts proposed memory titles from the markdown table in a TeamBrain PR body.
 */
export function extractProposedTitles(prBody: string): string[] {
  const titles: string[] = [];
  const lines = prBody.split('\n');
  
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('| Class | Title |')) {
      inTable = true;
      continue;
    }
    if (inTable && line.startsWith('| --- | --- |')) {
      continue;
    }
    
    if (inTable && line.startsWith('|')) {
      const parts = line.split(/(?<!\\)\|/); // Split by unescaped pipe
      if (parts.length >= 3) {
        let title = parts[2]!.trim();
        // Unescape any escaped pipes
        title = title.replace(/\\\|/g, '|');
        titles.push(title);
      }
    } else if (inTable && line.trim() === '') {
      inTable = false;
    }
  }
  
  return titles;
}

/**
 * Derives few-shot examples from past PR bodies and currently active memories.
 * 
 * - Accepted examples: The titles of active existing memories.
 * - Rejected examples: Proposed titles from past PRs that are NOT in existing memories.
 * 
 * To prevent the prompt from blowing up, we cap both lists (e.g. 5 of each).
 */
export function deriveFlywheelExamples(
  prBodies: string[],
  existingMemories: ExistingMemory[],
): FlywheelExamples {
  const existingTitles = new Set(existingMemories.map(m => m.title));
  
  const rejected = new Set<string>();
  for (const body of prBodies) {
    const proposed = extractProposedTitles(body);
    for (const title of proposed) {
      if (!existingTitles.has(title)) {
        rejected.add(title);
      }
    }
  }
  
  return {
    accepted: Array.from(existingTitles).slice(0, 5),
    rejected: Array.from(rejected).slice(0, 5),
  };
}
