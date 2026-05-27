import { describe, expect, it } from "vitest";
import { addBoundedSet, createGraphContextState, MAX_AUGMENT_CACHE_KEYS } from "./state";

describe("auto-context/state", () => {
	describe("createGraphContextState", () => {
		it("returns fresh state with defaults", () => {
			const state = createGraphContextState();
			expect(state.graphExists).toBe(false);
			expect(state.graphPath).toBe("");
			expect(state.reportPath).toBe("");
			expect(state.wikiIndexPath).toBe("");
			expect(state.reportContextInjected).toBe(false);
			expect(state.augmentHits).toBe(0);
			expect(state.hookFires).toBe(0);
			expect(state.augmentedCache.size).toBe(0);
			expect(state.emptyCache.size).toBe(0);
		});
	});

	describe("addBoundedSet", () => {
		it("adds entries to set", () => {
			const set = new Set<string>();
			addBoundedSet(set, "a", 3);
			addBoundedSet(set, "b", 3);
			expect(set.size).toBe(2);
			expect(set.has("a")).toBe(true);
			expect(set.has("b")).toBe(true);
		});

		it("evicts oldest entry when at capacity", () => {
			const set = new Set<string>();
			addBoundedSet(set, "a", 2);
			addBoundedSet(set, "b", 2);
			addBoundedSet(set, "c", 2);
			expect(set.size).toBe(2);
			expect(set.has("a")).toBe(false);
			expect(set.has("b")).toBe(true);
			expect(set.has("c")).toBe(true);
		});

		it("respects MAX_AUGMENT_CACHE_KEYS constant", () => {
			expect(MAX_AUGMENT_CACHE_KEYS).toBe(256);
		});
	});
});
