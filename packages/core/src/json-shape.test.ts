import { describe, expect, test } from "bun:test";
import { type JsonShape, jqSegment, jsonShapeOf, MAX_JSON_DEPTH } from "./json-shape.ts";

const branch = (shape: JsonShape) => {
	if (shape.kind !== "branch") throw new Error(`expected a branch, got ${shape.kind}`);
	return Object.fromEntries(shape.children.map((c) => [c.key, c.shape]));
};

const annotation = (shape: JsonShape | null) => {
	if (shape === null || shape.kind !== "leaf") throw new Error("expected a leaf");
	return shape.annotation;
};

describe("jsonShapeOf (value -> structure, values never leave)", () => {
	test("an object is a branch whose children keep JSON order", () => {
		const shape = jsonShapeOf('{"db_host":"h","db_port":5432,"api":{"retry":3,"timeout":30}}');
		expect(shape?.kind).toBe("branch");
		if (shape?.kind !== "branch") return;
		expect(shape.children.map((c) => c.key)).toEqual(["db_host", "db_port", "api"]);
		expect(annotation(shape.children[0]?.shape ?? null)).toBe("string");
		expect(annotation(shape.children[1]?.shape ?? null)).toBe("number");
		const api = branch(shape.children[2]?.shape as JsonShape);
		expect(Object.keys(api)).toEqual(["retry", "timeout"]);
	});

	test("an array is one leaf with its length, never expanded", () => {
		expect(annotation(jsonShapeOf("[1,2,3]"))).toBe("array(3)");
		const shape = jsonShapeOf('{"hosts":[{"name":"a"},{"name":"b"}]}');
		const hosts = shape?.kind === "branch" ? shape.children[0]?.shape : null;
		expect(annotation(hosts ?? null)).toBe("array(2)");
	});

	test("a scalar carries its JSON type, an empty object is object(0)", () => {
		expect(annotation(jsonShapeOf('"x"'))).toBe("string");
		expect(annotation(jsonShapeOf("42"))).toBe("number");
		expect(annotation(jsonShapeOf("false"))).toBe("boolean");
		expect(annotation(jsonShapeOf("null"))).toBe("null");
		expect(annotation(jsonShapeOf("{}"))).toBe("object(0)");
		expect(annotation(jsonShapeOf("[]"))).toBe("array(0)");
	});

	test("a value that is not JSON is not a shape", () => {
		expect(jsonShapeOf("ghp_secret_value")).toBeNull();
		expect(jsonShapeOf("")).toBeNull();
		expect(jsonShapeOf("{not json")).toBeNull();
	});

	test("deep nesting stops at the cap instead of recursing forever", () => {
		let deep = "1";
		for (let i = 0; i < MAX_JSON_DEPTH + 10; i++) deep = `{"k":${deep}}`;
		let shape = jsonShapeOf(deep);
		let depth = 0;
		while (shape?.kind === "branch") {
			depth += 1;
			shape = shape.children[0]?.shape ?? null;
			if (depth > MAX_JSON_DEPTH + 2) break;
		}
		expect(depth).toBe(MAX_JSON_DEPTH);
		expect(annotation(shape)).toBe("too-deep");
	});

	test("the shape never carries a stored value", () => {
		const shape = jsonShapeOf('{"db_host":"db.internal","token":"sk-live-1"}');
		const json = JSON.stringify(shape);
		expect(json).toContain("db_host");
		expect(json).not.toContain("db.internal");
		expect(json).not.toContain("sk-live-1");
	});
});

describe("jqSegment (standard jq spelling for a key)", () => {
	test("identifier keys take the dot form", () => {
		expect(jqSegment("db_host")).toBe(".db_host");
		expect(jqSegment("_x1")).toBe("._x1");
	});

	test("anything else is bracket-quoted and JSON-escaped", () => {
		expect(jqSegment("client.email")).toBe('["client.email"]');
		expect(jqSegment("0")).toBe('["0"]');
		expect(jqSegment("a b")).toBe('["a b"]');
		expect(jqSegment('a"b')).toBe('["a\\"b"]');
	});
});
