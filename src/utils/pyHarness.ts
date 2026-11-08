/**
 * The Python that runs inside Pyodide (or plain Python in the tests). It executes the candidate's code, then
 * either just reports what it printed, or runs the question's test cases and reports each result as JSON.
 */
export const PY_HARNESS = String.raw`
import json, sys, io, copy, traceback, contextlib

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def _to_list_node(a):
    head = None
    for v in reversed(a):
        head = ListNode(v, head)
    return head

def _from_list_node(n):
    out, seen = [], 0
    while n is not None and seen < 100000:
        out.append(n.val)
        n = n.next
        seen += 1
    return out

def _to_tree(a):
    if not a or a[0] is None:
        return None
    root = TreeNode(a[0])
    q, i = [root], 1
    while q and i < len(a):
        node = q.pop(0)
        if i < len(a) and a[i] is not None:
            node.left = TreeNode(a[i]); q.append(node.left)
        i += 1
        if i < len(a) and a[i] is not None:
            node.right = TreeNode(a[i]); q.append(node.right)
        i += 1
    return root

def _from_tree(root):
    if root is None:
        return []
    out, q = [], [root]
    while q:
        n = q.pop(0)
        if n is None:
            out.append(None)
        else:
            out.append(n.val); q.append(n.left); q.append(n.right)
    while out and out[-1] is None:
        out.pop()
    return out

def _conv_in(v, kind):
    if kind == "list": return _to_list_node(v)
    if kind == "tree": return _to_tree(v)
    return v

def _conv_out(v, kind):
    if kind == "list": return _from_list_node(v)
    if kind == "tree": return _from_tree(v)
    return v

def _norm(x):
    if isinstance(x, (list, tuple)):
        return sorted((_norm(i) for i in x), key=repr)
    return x

def _same(a, b, unordered):
    if unordered:
        a, b = _norm(a), _norm(b)
    if isinstance(a, float) or isinstance(b, float):
        try:
            return abs(a - b) < 1e-5
        except Exception:
            return False
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(_same(x, y, False) for x, y in zip(a, b))
    return a == b

def _show(x):
    s = repr(x)
    return s if len(s) <= 300 else s[:300] + "..."

def _find_entry(ns, name):
    if name in ns and callable(ns[name]):
        return ns[name]
    if "Solution" in ns:
        return getattr(ns["Solution"](), name)
    raise NameError("Define " + name + " (or a class Solution with that method).")

def _run_function(ns, spec, t):
    fn = _find_entry(ns, spec["entry"])
    args = list(eval("(" + t["input"] + ",)", {}))
    kinds = spec.get("argKinds") or []
    conv = [_conv_in(a, kinds[i] if i < len(kinds) else "plain") for i, a in enumerate(args)]
    res = fn(*conv)
    rk = spec.get("returnKind", "plain")
    if rk == "arg0":
        return _conv_out(conv[0], kinds[0] if kinds else "plain")
    return _conv_out(res, rk)

def _run_design(ns, spec, t):
    names, argl = eval("(" + t["input"] + ",)", {})[:2]
    cls = ns[spec["entry"]]
    obj, out = None, []
    for i, (n, a) in enumerate(zip(names, argl)):
        if i == 0:
            obj = cls(*a); out.append(None)
        else:
            out.append(getattr(obj, n)(*a))
    return out

def __br_run(code, spec_json, mode):
    ns = {"ListNode": ListNode, "TreeNode": TreeNode, "__name__": "__main__"}
    buf = io.StringIO()
    result = {"stdout": "", "error": None, "tests": []}
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            exec(compile(code, "solution.py", "exec"), ns)
    except BaseException:
        tb = traceback.format_exc().splitlines()
        result["error"] = "\n".join(l for l in tb if "<exec>" not in l and "pyodide" not in l.lower())[-1500:]
    if mode == "tests" and result["error"] is None:
        spec = json.loads(spec_json)
        for t in spec["tests"]:
            r = {"ok": False, "input": t["input"][:300], "expected": t["expected"][:300], "actual": "", "hidden": bool(t.get("hidden")), "error": None}
            try:
                with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                    got = _run_design(ns, spec, t) if spec["mode"] == "design" else _run_function(ns, spec, t)
                want = eval(t["expected"], {})
                r["ok"] = bool(_same(got, want, bool(spec.get("unordered"))))
                r["actual"] = _show(got)
            except BaseException as e:
                r["error"] = (type(e).__name__ + ": " + str(e))[:300]
            result["tests"].append(r)
    out = buf.getvalue()
    result["stdout"] = out if len(out) <= 5000 else out[:5000] + "\n... (output cut)"
    return json.dumps(result)
`;
