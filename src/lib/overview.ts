// src/lib/overview.ts（任务 4 阶段的类型占位，任务 5 补全实现）
export interface MyItem { kind: "bug" | "task"; id: string; title: string; pri: string; status: string; scope: string; }
export interface ProjectStat { id: string; name: string; bugActive: number; bugResolved: number; bugClosed: number; }
