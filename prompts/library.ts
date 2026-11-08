/**
 * Curated question catalog. Only titles and tags live here; the full problem statement, examples, diagram,
 * tests and grading rubric are written by the model the first time someone opens a question, then stored in the
 * database so every later user gets them without spending any tokens.
 */
import type { QuestionType } from './interviewer.ts';

export type LibraryList = 'neetcode150' | 'system_design' | 'low_level_design';
export type LibraryDifficulty = 'Easy' | 'Medium' | 'Hard';

export interface LibraryEntry {
  id: string;
  list: LibraryList;
  type: QuestionType;
  title: string;
  topic: string;
  difficulty: LibraryDifficulty;
}

export const LIBRARY_LISTS: { id: LibraryList; label: string }[] = [
  { id: 'neetcode150', label: 'NeetCode 150' },
  { id: 'system_design', label: 'System design' },
  { id: 'low_level_design', label: 'Low-level design' },
];

const D = { E: 'Easy', M: 'Medium', H: 'Hard' } as const;
const coding = (topic: string, items: string): LibraryEntry[] =>
  items.split('|').map((s) => {
    const i = s.lastIndexOf(':');
    const title = s.slice(0, i);
    return { id: 'nc-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), list: 'neetcode150', type: 'coding', title, topic, difficulty: D[s.slice(i + 1) as 'E' | 'M' | 'H'] };
  });
const design = (list: 'system_design' | 'low_level_design', topic: string, difficulty: LibraryDifficulty, titles: string): LibraryEntry[] =>
  titles.split('|').map((title) => ({
    id: (list === 'system_design' ? 'sd-' : 'lld-') + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    list,
    type: list,
    title: list === 'system_design' ? 'Design ' + title : 'Design ' + title,
    topic,
    difficulty,
  }));

export const LIBRARY: LibraryEntry[] = [
  ...coding('Arrays & Hashing', 'Contains Duplicate:E|Valid Anagram:E|Two Sum:E|Group Anagrams:M|Top K Frequent Elements:M|Encode and Decode Strings:M|Product of Array Except Self:M|Valid Sudoku:M|Longest Consecutive Sequence:M'),
  ...coding('Two Pointers', 'Valid Palindrome:E|Two Sum II - Input Array Is Sorted:M|3Sum:M|Container With Most Water:M|Trapping Rain Water:H'),
  ...coding('Sliding Window', 'Best Time to Buy and Sell Stock:E|Longest Substring Without Repeating Characters:M|Longest Repeating Character Replacement:M|Permutation in String:M|Minimum Window Substring:H|Sliding Window Maximum:H'),
  ...coding('Stack', 'Valid Parentheses:E|Min Stack:M|Evaluate Reverse Polish Notation:M|Generate Parentheses:M|Daily Temperatures:M|Car Fleet:M|Largest Rectangle in Histogram:H'),
  ...coding('Binary Search', 'Binary Search:E|Search a 2D Matrix:M|Koko Eating Bananas:M|Find Minimum in Rotated Sorted Array:M|Search in Rotated Sorted Array:M|Time Based Key-Value Store:M|Median of Two Sorted Arrays:H'),
  ...coding('Linked List', 'Reverse Linked List:E|Merge Two Sorted Lists:E|Reorder List:M|Remove Nth Node From End of List:M|Copy List with Random Pointer:M|Add Two Numbers:M|Linked List Cycle:E|Find the Duplicate Number:M|LRU Cache:M|Merge k Sorted Lists:H|Reverse Nodes in k-Group:H'),
  ...coding('Trees', 'Invert Binary Tree:E|Maximum Depth of Binary Tree:E|Diameter of Binary Tree:E|Balanced Binary Tree:E|Same Tree:E|Subtree of Another Tree:E|Lowest Common Ancestor of a Binary Search Tree:M|Binary Tree Level Order Traversal:M|Binary Tree Right Side View:M|Count Good Nodes in Binary Tree:M|Validate Binary Search Tree:M|Kth Smallest Element in a BST:M|Construct Binary Tree from Preorder and Inorder Traversal:M|Binary Tree Maximum Path Sum:H|Serialize and Deserialize Binary Tree:H'),
  ...coding('Heap / Priority Queue', 'Kth Largest Element in a Stream:E|Last Stone Weight:E|K Closest Points to Origin:M|Kth Largest Element in an Array:M|Task Scheduler:M|Design Twitter:M|Find Median from Data Stream:H'),
  ...coding('Backtracking', 'Subsets:M|Combination Sum:M|Permutations:M|Subsets II:M|Combination Sum II:M|Word Search:M|Palindrome Partitioning:M|Letter Combinations of a Phone Number:M|N-Queens:H'),
  ...coding('Tries', 'Implement Trie (Prefix Tree):M|Design Add and Search Words Data Structure:M|Word Search II:H'),
  ...coding('Graphs', 'Number of Islands:M|Max Area of Island:M|Clone Graph:M|Walls and Gates:M|Rotting Oranges:M|Pacific Atlantic Water Flow:M|Surrounded Regions:M|Course Schedule:M|Course Schedule II:M|Redundant Connection:M|Number of Connected Components in an Undirected Graph:M|Graph Valid Tree:M|Word Ladder:H'),
  ...coding('Advanced Graphs', 'Reconstruct Itinerary:H|Min Cost to Connect All Points:M|Network Delay Time:M|Swim in Rising Water:H|Alien Dictionary:H|Cheapest Flights Within K Stops:M'),
  ...coding('1-D Dynamic Programming', 'Climbing Stairs:E|Min Cost Climbing Stairs:E|House Robber:M|House Robber II:M|Longest Palindromic Substring:M|Palindromic Substrings:M|Decode Ways:M|Coin Change:M|Maximum Product Subarray:M|Word Break:M|Longest Increasing Subsequence:M|Partition Equal Subset Sum:M'),
  ...coding('2-D Dynamic Programming', 'Unique Paths:M|Longest Common Subsequence:M|Best Time to Buy and Sell Stock with Cooldown:M|Coin Change II:M|Target Sum:M|Interleaving String:M|Longest Increasing Path in a Matrix:H|Distinct Subsequences:H|Edit Distance:M|Burst Balloons:H|Regular Expression Matching:H'),
  ...coding('Greedy', 'Maximum Subarray:M|Jump Game:M|Jump Game II:M|Gas Station:M|Hand of Straights:M|Merge Triplets to Form Target Triplet:M|Partition Labels:M|Valid Parenthesis String:M'),
  ...coding('Intervals', 'Insert Interval:M|Merge Intervals:M|Non-overlapping Intervals:M|Meeting Rooms:E|Meeting Rooms II:M|Minimum Interval to Include Each Query:H'),
  ...coding('Math & Geometry', 'Rotate Image:M|Spiral Matrix:M|Set Matrix Zeroes:M|Happy Number:E|Plus One:E|Pow(x, n):M|Multiply Strings:M|Detect Squares:M'),
  ...coding('Bit Manipulation', 'Single Number:E|Number of 1 Bits:E|Counting Bits:E|Reverse Bits:E|Missing Number:E|Sum of Two Integers:M|Reverse Integer:M'),
  ...design('system_design', 'System design', 'Hard', 'Pastebin|Rate Limiter|Distributed Cache|Distributed Key-Value Store|Notification System|News Feed|Twitter|Instagram|WhatsApp or Chat System|YouTube or Netflix|Dropbox or Google Drive|Uber or Lyft|Google Maps|Web Crawler|Search Autocomplete|Ticketmaster|Airbnb|Distributed Message Queue|Unique ID Generator|Distributed Lock Service|Payment System|Stock Exchange|Real-Time Leaderboard|Metrics and Monitoring System|Log Aggregation System|Distributed Job Scheduler|API Gateway|Content Delivery Network|Video Conferencing (Zoom)|Collaborative Document Editor|Ad Click Aggregation|Food Delivery Service|Hotel Reservation System|E-commerce Platform|Proximity Service (Yelp)|Top-K Heavy Hitters|Email Service|Web Search Engine|Feature Flag Service|Online Judge|Music Streaming (Spotify)'),
  ...design('low_level_design', 'Low-level design', 'Medium', 'Parking Lot|Elevator System|Vending Machine|ATM|LRU Cache|LFU Cache|Tic-Tac-Toe|Chess|Snake and Ladder|Library Management System|Hotel Booking|Movie Ticket Booking|Splitwise|Rate Limiter (class design)|Logging Framework|Notification Service|Task Scheduler|In-Memory File System|Text Editor with Undo and Redo|Stack Overflow|Ride Sharing App|Food Ordering App|Shopping Cart|Chat Room|Publish-Subscribe System|Key-Value Store with TTL|Meeting Room Scheduler|Traffic Signal Controller|Social Network|Banking System|Coffee Machine|Blackjack|Connect Four|Inventory Management|Airline Reservation'),
];

export const LIBRARY_BY_ID: Record<string, LibraryEntry> = Object.fromEntries(LIBRARY.map((e) => [e.id, e]));
