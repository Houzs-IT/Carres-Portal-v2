import { describe, expect, it } from "vitest";
import { askNewModelInput, modelBuiltInput } from "./request-new-models";

describe("request new models input", () => {
  it("takes a named model with a qty, and refuses a blank name or zero qty", () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    expect(askNewModelInput.safeParse({ requestId, modelName: "Sofa X", qty: 2 }).success).toBe(true);
    expect(askNewModelInput.safeParse({ requestId, modelName: "  ", qty: 2 }).success).toBe(false);
    expect(askNewModelInput.safeParse({ requestId, modelName: "Sofa X", qty: 0 }).success).toBe(false);
  });

  it("needs the SKU the model was built as", () => {
    expect(modelBuiltInput.safeParse({ sku: "SF-X-01" }).success).toBe(true);
    expect(modelBuiltInput.safeParse({ sku: "" }).success).toBe(false);
  });
});
