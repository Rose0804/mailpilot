import { describe, expect, it } from "vitest";
import { canAutoExecute, requiresApproval, riskForAction } from "./index";

describe("邮箱操作策略", () => {
  it("允许低风险查询自动执行", () => {
    expect(riskForAction("search")).toBe("low");
    expect(canAutoExecute("search")).toBe(true);
    expect(requiresApproval("search")).toBe(false);
  });

  it("要求发送和删除经过审批", () => {
    expect(requiresApproval("send")).toBe(true);
    expect(requiresApproval("delete")).toBe(true);
    expect(riskForAction("delete")).toBe("critical");
  });
});
