/**
 * ATS Detector —— PRD §22。
 *
 * ## 为什么不能只看域名
 *
 * 最初的调研是按 hostname 推断的，实地探测推翻了这个做法：
 * **Moka 与北森都支持企业自有域名**。大疆用 `apply.careers.dji.com`，
 * vivo 用 `hr-campus.vivo.com`，光看域名一个都认不出来。
 *
 * 真正可靠的信号是**页面加载了谁家的脚本**：
 * Moka 的资源来自 `static-ats.mokahr.com`，北森来自 `acdn.bstatics.com`，
 * 飞书招聘来自 `lf-package-cn.feishucdn.com`。这个骗不了人 ——
 * 企业可以换域名，但换不掉 SaaS 供应商的 CDN。
 *
 * 所以检测分三层，置信度依次递减：
 *   1. 脚本资源来源（最可靠）
 *   2. URL 路径特征（次之，如 `/personal/deliveryRecord` 是北森的强特征）
 *   3. hostname（最弱，只在自有域名以外有效）
 */

export const AtsType = {
  MOKA: 'moka',
  FEISHU: 'feishu',
  BEISEN: 'beisen',
  REDSEA: 'redsea',
  WORKDAY: 'workday',
  UNKNOWN: 'unknown',
} as const;

export type AtsType = (typeof AtsType)[keyof typeof AtsType];

export const ATS_LABELS: Record<AtsType, string> = {
  moka: 'Moka',
  feishu: '飞书招聘',
  beisen: '北森',
  redsea: '红海云',
  workday: 'Workday',
  unknown: '未知 / 企业自研',
};

interface Signature {
  readonly ats: AtsType;
  /** 脚本、样式等资源的域名特征 —— 最可靠的信号 */
  readonly resourceHosts: readonly RegExp[];
  /** URL 路径特征 */
  readonly pathPatterns: readonly RegExp[];
  /**
   * ATS **自有** SaaS 域名。命中说明企业没换域名，这本身就是很强的信号。
   * 注意与「企业自有域名」区分：后者靠脚本来源才认得出。
   */
  readonly officialHosts: readonly RegExp[];
}

const SIGNATURES: readonly Signature[] = [
  {
    ats: AtsType.MOKA,
    resourceHosts: [/(^|\.)mokahr\.com$/i],
    pathPatterns: [/\/campus-recruitment\//i, /#\/(candidateHome|job)\//i],
    officialHosts: [/(^|\.)mokahr\.com$/i],
  },
  {
    ats: AtsType.FEISHU,
    resourceHosts: [/feishucdn\.com$/i, /(^|\.)bytescm\.com$/i, /(^|\.)snssdk\.com$/i],
    pathPatterns: [/\/campus(recruitment)?\/position/i],
    officialHosts: [/\.jobs\.feishu\.cn$/i],
  },
  {
    ats: AtsType.BEISEN,
    resourceHosts: [/(^|\.)bstatics\.com$/i],
    // 三家不同域名的企业站共用这个路径，是北森的强特征
    pathPatterns: [/\/personal\/deliveryRecord/i],
    officialHosts: [/\.zhiye\.com$/i],
  },
  {
    ats: AtsType.REDSEA,
    resourceHosts: [/redseatech|redsea/i],
    pathPatterns: [/RedseaPlatform/i],
    officialHosts: [],
  },
  {
    ats: AtsType.WORKDAY,
    resourceHosts: [/(^|\.)workday(cdn)?\.com$/i],
    pathPatterns: [/\/(wday|en-US)\//i],
    officialHosts: [/myworkdayjobs\.com$/i],
  },
];

export interface DetectionInput {
  readonly url: string;
  /** 页面加载过的资源 URL（脚本、样式）。传空数组也能工作，只是置信度低 */
  readonly resourceUrls?: readonly string[];
}

export interface DetectionResult {
  readonly ats: AtsType;
  readonly label: string;
  /** 0–1 */
  readonly confidence: number;
  /** 命中了哪些信号，供排查与日志 */
  readonly evidence: readonly string[];
}

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/**
 * 各层信号的权重。
 *
 * 资源来源给 0.7 而不是 1.0：理论上企业可以自建镜像，虽然罕见。
 * 官方域名给 0.55：企业没换域名时，域名本身几乎就能定案，配上路径特征即达阈值。
 * 而单靠路径只有 0.25 —— 像 `/personal/deliveryRecord` 这种特征虽然指向明确，
 * 但不排除别家用了相同的路径命名，不足以自动启用专用 Adapter。
 */
const WEIGHT = { resource: 0.7, path: 0.25, host: 0.55 } as const;

export function detectAts(input: DetectionInput): DetectionResult {
  const hostname = hostnameOf(input.url);
  const resourceHosts = (input.resourceUrls ?? [])
    .map(hostnameOf)
    .filter((host) => host.length > 0);

  let best: DetectionResult = {
    ats: AtsType.UNKNOWN,
    label: ATS_LABELS.unknown,
    confidence: 0,
    evidence: [],
  };

  for (const signature of SIGNATURES) {
    const evidence: string[] = [];
    let score = 0;

    const resourceHit = resourceHosts.find((host) =>
      signature.resourceHosts.some((pattern) => pattern.test(host)),
    );
    if (resourceHit !== undefined) {
      score += WEIGHT.resource;
      evidence.push(`资源来自 ${resourceHit}`);
    }

    if (signature.pathPatterns.some((pattern) => pattern.test(input.url))) {
      score += WEIGHT.path;
      evidence.push('URL 路径特征匹配');
    }

    if (signature.officialHosts.some((pattern) => pattern.test(hostname))) {
      score += WEIGHT.host;
      evidence.push(`域名 ${hostname} 是该 ATS 的官方域名`);
    }

    if (score > best.confidence) {
      best = {
        ats: signature.ats,
        label: ATS_LABELS[signature.ats],
        confidence: Math.min(Math.round(score * 100) / 100, 1),
        evidence,
      };
    }
  }

  return best;
}

/** 置信度是否足以启用专用 Adapter。低于阈值时退回 GenericAdapter */
export const ADAPTER_CONFIDENCE_THRESHOLD = 0.6;

export const shouldUseAdapter = (result: DetectionResult): boolean =>
  result.ats !== AtsType.UNKNOWN && result.confidence >= ADAPTER_CONFIDENCE_THRESHOLD;
