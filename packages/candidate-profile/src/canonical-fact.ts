/**
 * Canonical Fact —— PRD §11 / §3.5。
 *
 * 这是整个系统对抗「LLM 编造经历」的地基：
 * 所有 Generated Content（针对某岗位改写的项目描述、压缩到 100 字的版本等）
 * 都必须能 trace back 到一条或多条 CanonicalFact。
 *
 * 每条 fact 是一个**原子事实**，例如：
 *   - 「使用 ROS2」
 *   - 「真机采集 200 条轨迹」
 *   - 「单臂抓取成功率 90.4%」
 *
 * 带量化数字的 fact 单独标记 `metric`，因为「编造量化成果」是最危险的一类失真，
 * M6 的内容校验器会重点核对生成文本中出现的数字是否都有 fact 背书。
 */

import { z } from 'zod';
import { IdSchema, NonEmptyString } from './common.js';

export const CanonicalFactSchema = z.object({
  id: IdSchema,
  /** 事实陈述本身，必须是用户确认过的客观描述 */
  statement: NonEmptyString,
  /**
   * 该事实中包含的量化指标，例如 ['90.4%', '200 条轨迹']。
   * 生成内容里出现的数字必须能在这里找到出处。
   */
  metrics: z.array(NonEmptyString).default([]),
  /** 佐证材料：论文、专利、仓库链接、证书 assetId */
  evidence: z.array(NonEmptyString).default([]),
});

export type CanonicalFact = z.infer<typeof CanonicalFactSchema>;

/** 汇总一组 fact 中出现过的全部量化指标，供内容生成校验使用。 */
export function collectMetrics(facts: readonly CanonicalFact[]): Set<string> {
  const metrics = new Set<string>();
  for (const fact of facts) {
    for (const metric of fact.metrics) metrics.add(metric);
  }
  return metrics;
}
