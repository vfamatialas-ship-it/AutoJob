/**
 * ATSAdapter 接口 —— PRD §23。
 *
 * 「不要让业务层知道具体网站 DOM。」
 *
 * ## 接口设计的取舍
 *
 * PRD 列了 14 个方法。全部做成必选会让每个 Adapter 都被迫实现一堆用不上的东西，
 * 所以这里只把**每个 ATS 都必须回答的问题**设为必选：
 *
 *   我是谁（detect）、有哪些岗位（listJobs）、怎么进申请页（openApplication）、
 *   表单长什么样（parseForm）
 *
 * 其余（提交、验证、可重复区块、上传）设为可选，缺省时回落到通用实现。
 * 这样新增一个 ATS 的起步成本很低 —— 先让它能读岗位，再逐步补齐。
 *
 * ## 为什么 Adapter 不自己填表
 *
 * 填写逻辑在 M5 的 FormFiller 里，它已经处理了自定义下拉、autocomplete、
 * 隐藏 file input 等一堆通用难题。Adapter 只负责把「这个站的表单在哪、
 * 长什么样」告诉上层，具体怎么填不该每家重写一遍。
 */

import type { Page } from 'playwright';
import type { AtsType, DetectionResult } from './detector.js';

/** Adapter 眼中的岗位。字段与 job-discovery 的 Job 对齐，但不强制依赖那个包 */
export interface AdapterJob {
  readonly externalJobId: string;
  readonly title: string;
  readonly url: string;
  readonly location: string;
  readonly department: string;
  readonly description: string;
}

export interface ListJobsOptions {
  /** 最多抓多少个，防止在超大企业站上无限翻页 */
  readonly limit?: number;
}

export interface SubmitResult {
  readonly submitted: boolean;
  /** 网站返回的确认文本，是「真的投出去了」的证据（PRD §60） */
  readonly confirmationText: string;
  readonly detail: string;
}

export interface ATSAdapter {
  readonly ats: AtsType;
  readonly label: string;

  /** 判断当前页面是否属于本 ATS */
  detect(page: Page, url: string): Promise<DetectionResult>;

  /** 抓取岗位列表。只读，不得进入申请流程 */
  listJobs(page: Page, url: string, options?: ListJobsOptions): Promise<readonly AdapterJob[]>;

  /**
   * 从岗位页导航到申请表。
   * 返回 false 表示需要用户介入（通常是要登录）。
   */
  openApplication(page: Page, jobUrl: string): Promise<boolean>;

  /**
   * 等待申请表渲染完成。
   * SPA 站点的表单是异步的，不等就会解析到空页面 —— M7 在真实站点上吃过这个亏。
   */
  waitForForm?(page: Page): Promise<boolean>;

  /**
   * 提交申请。**必须由用户确认后才能调用**（PRD §3.7）。
   * 未实现时上层不会提供提交能力，只能由用户手动点。
   */
  submit?(page: Page): Promise<SubmitResult>;

  /** 验证是否真的提交成功。不能因为点了按钮就认为成功（PRD §60） */
  verifySubmission?(page: Page): Promise<SubmitResult>;
}

/** Adapter 注册表。按 atsType 查找 */
export class AdapterRegistry {
  private readonly adapters = new Map<AtsType, ATSAdapter>();

  register(adapter: ATSAdapter): void {
    this.adapters.set(adapter.ats, adapter);
  }

  get(ats: AtsType): ATSAdapter | undefined {
    return this.adapters.get(ats);
  }

  list(): readonly ATSAdapter[] {
    return [...this.adapters.values()];
  }
}
