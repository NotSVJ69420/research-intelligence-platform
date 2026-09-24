import 'dotenv/config';
import { setTimeout as sleep } from 'node:timers/promises';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

/**
 * AI Service for processing paper data with Groq API.
 * Includes rate limiting and retry logic.
 */
class AIService {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    if (!this.apiKey || this.apiKey === 'your_key_here') {
      console.warn('[AI Service] GROQ_API_KEY not configured in .env');
      this.apiKey = null;
    }
    this.lastRequestTime = 0;
    this.minRequestInterval = parseInt(process.env.AI_MIN_INTERVAL) || 2000; // 2s between requests
    this.maxRetries = parseInt(process.env.AI_MAX_RETRIES) || 3;
  }

  /**
   * Summarize or analyze paper content with retry logic.
   * @param {Object} paper - Paper metadata and/or text.
   * @param {string} prompt - Specific instruction for analysis.
   * @param {number|null} retries - Override retry count.
   * @returns {Promise<string>} Analysis text.
   */
  async analyzePaper(paper, prompt = 'Summarize the following research paper:', retries = null) {
    if (!this.apiKey) throw new Error('AI service not initialized. Set GROQ_API_KEY in .env');

    const maxRetries = retries !== null ? retries : this.maxRetries;

    // Rate limiting: enforce minimum interval between requests
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await sleep(this.minRequestInterval - elapsed);
    }

    const userMessage = `Paper Title: ${paper.title}\nAbstract: ${paper.abstract}\n\nTask: ${prompt}`;

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        this.lastRequestTime = Date.now();

        const response = await fetch(GROQ_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              { role: 'system', content: 'You are a research assistant that analyzes academic papers concisely and accurately.' },
              { role: 'user',   content: userMessage },
            ],
            temperature: 0.3,
            max_tokens: 1024,
          }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          const errMsg  = errBody?.error?.message || response.statusText;
          const err     = new Error(`Groq API error ${response.status}: ${errMsg}`);
          err.status    = response.status;
          throw err;
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content ?? '';

      } catch (error) {
        attempt++;
        const isRateLimit = error.status === 429 || error.message?.includes('429');

        if (isRateLimit && attempt <= maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          console.warn(`[AI Service] Rate limit hit (attempt ${attempt}/${maxRetries}). Waiting ${Math.round(waitTime / 1000)}s...`);
          await sleep(waitTime);
          continue;
        }

        console.error('[AI Service] Groq analysis failed:', error.message);
        throw error;
      }
    }
  }
}

export default new AIService();
