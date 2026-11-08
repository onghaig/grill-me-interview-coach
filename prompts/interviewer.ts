/**
 * Bar Raiser: interviewer system instructions
 * You can edit this file to customize the interviewer's behavior, persona,
 * question expectations, or phase transitions.
 */

export type QuestionType = 'system_design' | 'low_level_design' | 'coding' | 'behavioral';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  system_design: 'System design',
  low_level_design: 'Low-level design',
  coding: 'Coding',
  behavioral: 'Behavioral',
};

export interface RubricCategory {
  name: string;
  /** Relative weight, all categories sum to 100. */
  weight: number;
  description: string;
  strongSignals: string[];
  weakSignals: string[];
}

export interface Rubric {
  categories: RubricCategory[];
  /** Topics a strong candidate must touch; the interviewer probes for these. */
  mustCover: string[];
  /** Things that should count heavily against the candidate. */
  redFlags: string[];
}

/** One planned behavioral question, tied to a principle and (when possible) something on the resume. */
export interface PlannedQuestion {
  competency: string;
  question: string;
  followUps: string[];
  /** The resume item this question is anchored on, if any. */
  anchor?: string;
}

export interface SystemDesignQuestion {
  id: string;
  /** Defaults to system_design when absent (the built-in classics). */
  type?: QuestionType;
  title: string;
  difficulty: 'Medium' | 'Hard' | 'Very Hard';
  scale: string;
  description: string;
  suggestedRequirements: {
    functional: string[];
    nonFunctional: string[];
  };
  keyComponents: string[];
  questionNotes: string;
  /** Present for AI-generated questions; grading uses it instead of the default categories. */
  rubric?: Rubric;
  /** Behavioral interviews only: the question plan the interviewer works through. */
  plannedQuestions?: PlannedQuestion[];
}

export const SYSTEM_DESIGN_QUESTIONS: SystemDesignQuestion[] = [
  {
    id: 'tinyurl',
    title: 'Design a URL Shortening Service (TinyURL / Bitly)',
    difficulty: 'Medium',
    scale: '100M new URLs/month, 100:1 read-to-write ratio (10B reads/month)',
    description: 'Design a scalable, highly available URL shortening service that generates compact unique aliases for long URLs and redirects clients with sub-10ms latency.',
    suggestedRequirements: {
      functional: ['Shorten long URL to 7-character hash', 'Redirect short URL to original destination (HTTP 301 vs 302)', 'Custom alias support', 'URL expiration and analytics'],
      nonFunctional: ['Sub-10ms redirect latency', '99.99% read availability', 'Shortened links must not be guessable / sequential', 'Horizontally scalable storage']
    },
    keyComponents: ['API Gateway / Reverse Proxy', 'Token Generator / KGS (Key Generation Service)', 'Distributed NoSQL / Key-Value Store (Cassandra or DynamoDB)', 'Redis LRU Cache', 'Analytics Message Queue (Kafka)'],
    questionNotes: `Key areas to probe:
- Hash collisions: Base62 vs MD5/SHA256 truncation. If using hash of URL, how do they handle collision detection without an expensive DB roundtrip? Push towards Key Generation Service (pre-generated unique keys) or distributed sequence generator (Snowflake).
- 301 vs 302 redirect trade-off: 301 Permanent Redirect caches in browser (saves server load but breaks click analytics); 302 Temporary Redirect hits server every time (accurate analytics, higher load).
- Scale math: 100M writes/month = ~40 writes/sec. 10B reads/month = ~4,000 reads/sec (peak 10,000 reads/sec). Storage over 5 years: 100M * 12 * 5 = 6B URLs * 500 bytes = ~3TB. Easily fits in distributed NoSQL.
- Cache sizing: 80/20 rule: 20% of hot URLs generate 80% of traffic. Daily read volume is ~330M requests. 20% of 330M is 66M URLs * 500B = ~33GB RAM. Fits in a single Redis node; use Redis cluster with master-replica for high availability.
- Single points of failure: KGS standby node, Redis cache eviction policy (LRU).`
  },
  {
    id: 'rate-limiter',
    title: 'Design a Distributed API Rate Limiter',
    difficulty: 'Hard',
    scale: '500,000 requests/sec across multi-region edge clusters',
    description: 'Design a high-throughput, low-latency distributed rate limiter that protects downstream microservices from abuse while maintaining sub-millisecond overhead.',
    suggestedRequirements: {
      functional: ['Rate limit by User ID, IP address, or API key', 'Configurable rules per endpoint / tier', 'Informative HTTP 429 headers (Retry-After, X-RateLimit-Remaining)'],
      nonFunctional: ['Ultra-low latency (<2ms overhead)', 'Distributed synchronization across regions', 'High availability: fail-open if rate limiter cluster degrades', 'Accurate token counting without race conditions']
    },
    keyComponents: ['Edge Envoy / Nginx Proxy Filter', 'Redis Cluster with Lua Scripts (Token Bucket / Sliding Window Log)', 'Local In-Memory Cache (L1) with Async Sync', 'Config Management Service (ZooKeeper/Consul)'],
    questionNotes: `Key areas to probe:
- Algorithm choice: Token Bucket vs Leaky Bucket vs Sliding Window Counter. Token bucket allows bursts; sliding window counter is memory-efficient with minimal boundary edge cases.
- Concurrency & Race Conditions: If two requests arrive concurrently, how do they prevent write skew? Push for Redis Lua scripts to execute get-and-increment atomically.
- Multi-Region Latency: Network roundtrips across regions add 50-100ms. Probe how they avoid cross-region sync on every request: local in-memory L1 cache with periodic asynchronous batch synchronization, or edge Envoy filters with token leasing.
- Failure Mode: What happens when Redis cluster goes down? Fail-open vs Fail-closed. Production systems almost always fail-open with alert paging.
- Hot Keys: How to handle high-traffic API keys or DDoS targeting one tenant (consistent hashing with virtual nodes, local rate limiting).`
  },
  {
    id: 'twitter-feed',
    title: 'Design Twitter / X News Feed',
    difficulty: 'Hard',
    scale: '300M Daily Active Users, 500M tweets/day, average followings 200',
    description: 'Design a social news feed timeline that supports fast tweet posting and real-time timeline generation for both normal users and high-fanout celebrity accounts.',
    suggestedRequirements: {
      functional: ['Post tweet with text/media', 'Timeline generation (chronological + ranked)', 'Follow/unfollow users'],
      nonFunctional: ['Sub-200ms home timeline loading', 'High availability over strong consistency (Eventual consistency)', 'Celebrity fanout problem mitigation (Hybrid Push/Pull model)']
    },
    keyComponents: ['Fanout Service', 'Timeline Cache (Redis list per active user)', 'Social Graph Service (Neo4j or sharded MySQL)', 'Blob Store & CDN for media', 'Kafka Event Bus'],
    questionNotes: `Key areas to probe:
- Fanout on Write (Push) vs Fanout on Read (Pull):
  * Push: Fast reads (O(1) fetch from user timeline cache), expensive writes for users with millions of followers (celebrity problem).
  * Pull: Fast writes (just write tweet to DB), expensive reads (merge feeds from 500 followees on every page refresh).
  * Hybrid: Push for regular users (<20,000 followers); Pull dynamically at query time for celebrities (>20,000 followers).
- Active vs Inactive Users: Don't precompute feeds for users who haven't logged in for 30 days. Evict inactive feeds from Redis.
- Storage: 500M tweets/day * 300 bytes metadata = 150GB/day metadata. Media stored in S3/GCS with CDN caching.
- Timeline pagination: Don't use SQL OFFSET/LIMIT (terrible performance at large offsets). Use cursor-based pagination (since_id / max_id).`
  },
  {
    id: 'whatsapp-chat',
    title: 'Design a Real-time Chat System (WhatsApp / Slack)',
    difficulty: 'Hard',
    scale: '1 Billion DAU, 100 Billion messages/day, 1:1 and group chats up to 500 members',
    description: 'Design an end-to-end encrypted, low-latency messaging system that guarantees reliable message delivery, offline queuing, and read receipts across billions of devices.',
    suggestedRequirements: {
      functional: ['1:1 and group messaging', 'Online/offline presence status', 'Message delivery receipts (Sent, Delivered, Read)', 'Media attachments'],
      nonFunctional: ['Real-time message delivery (<100ms)', 'No message loss; durable offline delivery', 'End-to-End Encryption key exchange', 'Battery & connection efficient']
    },
    keyComponents: ['WebSocket Gateway (Stateful persistent connections)', 'Chat Service', 'Session / Connection Manager (Redis mapping user -> gateway host)', 'Cassandra / ScyllaDB Message Store', 'Push Notification Service (FCM/APNS)'],
    questionNotes: `Key areas to probe:
- Connection Management: WebSockets vs Long Polling vs gRPC streaming. WebSockets maintain persistent bidirectional duplex connections.
- Routing to Recipient: When Alice sends a message to Bob, how does Alice's WebSocket gateway know which gateway server Bob is connected to? Push for Session/Connection Service (Redis key-value: userId -> gateway_server_ip).
- Message ordering: Millisecond timestamps will collide. Use sequence numbers or distributed IDs (e.g. Snowflake ID per chat channel) or vector clocks.
- Group chat fanout: In a 500-person group, 1 message = 500 delivery events. Don't replicate 500 copies of the message in the database; store 1 message record and distribute pointers/IDs.
- Offline delivery: When recipient is offline, store in offline queue (e.g. ScyllaDB or RabbitMQ) and trigger push notification via APNS/FCM. When device reconnects, batch sync unread messages.`
  },
  {
    id: 'youtube-streaming',
    title: 'Design YouTube / Video Streaming Platform',
    difficulty: 'Very Hard',
    scale: '2 Billion users, 500 hours of video uploaded every minute, millions of concurrent streams',
    description: 'Design an end-to-end video platform supporting multi-gigabyte video uploads, asynchronous distributed transcoding, and low-buffering global adaptive streaming.',
    suggestedRequirements: {
      functional: ['Upload video files', 'Transcode into multiple resolutions (1080p, 720p, 480p, HLS/DASH)', 'Stream video smoothly based on viewer bandwidth', 'Search & view count metrics'],
      nonFunctional: ['Smooth playback without buffering (<2s start latency)', 'High storage durability', 'Global CDN delivery optimization', 'Cost-effective storage tiering']
    },
    keyComponents: ['Chunked Resumable Upload Service', 'Distributed Transcoding Pipeline (DAG Workers / Celery)', 'Blob Store (S3 / GCS)', 'Global CDN (Cloudflare/Fastly)', 'Metadata DB (Postgres/Spanner)'],
    questionNotes: `Key areas to probe:
- Upload pipeline: Resumable chunked uploads directly to object storage via pre-signed URLs to avoid bottlenecking web servers.
- Transcoding pipeline: Asynchronous message queue (Kafka/RabbitMQ) feeding worker nodes. DAG processing: split video into GOP (Group of Pictures) chunks, transcode chunks in parallel into multiple codecs/bitrates (HLS / MPEG-DASH), and stitch manifest files (.m3u8).
- View counting at scale: If millions watch the same video simultaneously, write contention on a single DB row is catastrophic. Decouple writes with in-memory counting buffers (Redis hyperloglog / Redis increment with batch flush to SQL every 10 seconds).
- CDN caching & egress cost: Videos exhibit extreme long-tail distribution. Cache popular 20% videos at edge CDNs. Cold videos served from cost-effective object storage tiers.`
  }
];

const TYPE_BLOCKS: Record<QuestionType, { role: string; flow: string }> = {
  behavioral: {
    role: 'a 30-minute behavioral interview',
    flow: `- This is a conversation about the candidate's past experience. There is no whiteboard or code, so never refer to one.
- Work through the planned questions in the private notes in order, skipping or merging any that were already covered. Ask ONE question at a time, and use the resume anchors to make it specific ("I saw you led the payments migration at Acme. Tell me about a time things went sideways on it").
- Ask for a specific example from their own experience, not hypotheticals or generalities. If they answer in the abstract ("I usually..."), ask for the one time it actually happened.
- Probe for STAR without naming it: the situation and stakes, what THEY personally did (separate "I" from "we"), the decisions and trade-offs they made, the measurable result, and what they would do differently.
- Ask follow-ups before moving on: why that choice, what the other person said, how you knew it worked, what it cost. Two or three follow-ups on a good story are better than skimming many.
- If an answer is thin, say so politely and dig ("Can you give me the numbers?", "What was your specific part in that?"). If a story is strong, acknowledge it briefly and move on.
- Keep track of the time. Cover at most six to eight stories in thirty minutes, and wrap up with a chance for them to ask you a question.
- Stay warm but evidence-driven. Do not coach them on how to answer better during the interview.`,
  },
  system_design: {
    role: 'a 30-minute system design interview',
    flow: `- Follow the phases: clarify requirements, estimate scale, high-level design, deep dive, wrap-up.
- Messages starting with [DIAGRAM UPDATE] are the candidate's whiteboard. Refer to it naturally ("I see Redis in front of Postgres, why that?"). Never read it aloud.
- Push back on hand-waving: ask for numbers, failure modes and trade-offs.`,
  },
  low_level_design: {
    role: 'a 30-minute low-level (object-oriented) design interview',
    flow: `- Follow the phases: clarify requirements and use cases, identify core entities, design classes and interfaces, then extensibility and edge cases, then wrap-up.
- Messages starting with [DIAGRAM UPDATE] are the candidate's class diagram on the whiteboard; messages starting with [CODE UPDATE] are the code they have typed. Refer to either naturally ("I see Vehicle has a subclass per type, what happens when we add a new one?"). Never read code aloud.
- Probe: responsibilities and cohesion, SOLID, fitting design patterns (and when a pattern is overkill), interfaces vs inheritance, concurrency and thread safety, error handling, and how the design changes when a new requirement lands.
- Ask them to write the key classes or method signatures in the code editor and to walk you through one scenario end to end.`,
  },
  coding: {
    role: 'a 30-minute algorithms and data structures coding interview (LeetCode style)',
    flow: `- Follow the phases: clarify the problem and examples, discuss approach from brute force to optimal with complexity, implement in the code editor, test with a dry run and edge cases, then follow-ups.
- Messages starting with [CODE UPDATE] are the candidate's current code in the editor. Read it silently, notice bugs and complexity problems, and refer to specific lines or ideas naturally. Never read code aloud verbatim.
- Do not reveal the solution. Use a hint ladder: first a guiding question, then point at the data structure or technique to consider, only then a concrete hint. Note privately how many hints they needed.
- Ask for time and space complexity. Ask them to trace their code on an example, and to name edge cases (empty input, duplicates, overflow, large n) before you point any out.
- Do not accept "it works" without a dry run. If you spot a bug, ask them to test an input that exposes it rather than telling them.
- The whiteboard is available for sketching examples, trees or pointers.`,
  },
};

export function getInterviewerSystemInstruction(question: SystemDesignQuestion): string {
  const type: QuestionType = question.type || 'system_design';
  const block = TYPE_BLOCKS[type];
  const rubricText = question.rubric
    ? `

Grading rubric (private; steer the conversation so the candidate has a chance to show each of these, but never reveal it):
${question.rubric.categories.map((c) => `- ${c.name} (${c.weight}%): ${c.description}`).join('\n')}
Must-cover topics: ${question.rubric.mustCover.join('; ')}
Red flags to watch for: ${question.rubric.redFlags.join('; ')}`
    : '';

  const planText =
    question.type === 'behavioral' && question.plannedQuestions?.length
      ? `

Planned questions (private; ask them one at a time in roughly this order, adapt to what the candidate says, and never read them out as a list):
${question.plannedQuestions
  .map(
    (q, i) =>
      `${i + 1}. [${q.competency}] ${q.question}${q.anchor ? ` (anchor: ${q.anchor})` : ''}\n   Follow-ups: ${q.followUps.join(' / ')}`
  )
  .join('\n')}`
      : '';

  return `You are a senior ${question.type === 'behavioral' ? 'hiring manager and bar raiser' : 'staff engineer'} running ${block.role} over a voice call. The question is: ${question.title} (${question.scale}). ${question.description}

How you sound (this is spoken aloud, so it must sound like a real person talking):
- Talk like a relaxed, friendly-but-sharp colleague. Use contractions, plain words and natural rhythm ("Okay, got it.", "Hm, interesting.", "Right, and what happens when...").
- Keep turns short: one to three sentences, one question at a time. Never lecture.
- React to what they actually said before you ask the next thing. Vary your openers; don't repeat the same filler every turn.
- No lists, no markdown, no headings, no reading out symbols or code. Say numbers, big-O and acronyms the way a person would ("n log n", "O of one").
- If the candidate is mid-thought or pauses briefly, stay quiet. Only jump in once they've clearly finished a point or asked you something.

How you interview:
- Never give away the answer. Ask questions; don't propose the design or the algorithm.
- Messages starting with [COACH] are private guidance from the evaluator. Follow it at the next natural moment in your own words. Never quote it, never mention a coach or evaluator, and never say a bracketed tag aloud.
- When the call begins you will get a [START OF INTERVIEW] message. Follow its instructions for the opening exactly, then stop and wait for the candidate to speak.
- When the timer says to move on, say so like a real interviewer.
- If they're stuck: first a guiding question; if still stuck, point at the area to think about; only then a concrete hint.
- Be direct and fair, never flattering.
${block.flow}

Question notes (private, for probing): ${question.questionNotes}${planText}${rubricText}`;
}
