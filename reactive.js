const bucket = new WeakMap();

const data = { foo: 1, bar: 2 };

const obj = new Proxy(data, {
  get(target, key) {
    track(target, key);
    return target[key];
  },
  set(target, key, value) {
    target[key] = value;
    trigger(target, key);
    return true;
  },
});

function track(target, key) {
  if (!activeEffect) return;

  let depsMap = bucket.get(target);
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }

  let deps = depsMap.get(key);
  if (!deps) {
    depsMap.set(key, (deps = new Set()));
  }
  deps.add(activeEffect);
  activeEffect.deps.push(deps);
}

function trigger(target, key) {
  const depsMap = bucket.get(target);
  if (!depsMap) return;

  const effects = depsMap.get(key);

  const effectsToRun = new Set();
  effects?.forEach?.((effectFn) => {
    if (effectFn !== activeEffect) {
      effectsToRun.add(effectFn);
    }
  });

  effectsToRun?.forEach?.((fn) => {
    if (fn.options?.scheduler) {
      fn.options.scheduler(fn);
    } else {
      fn();
    }
  });
}

const jobQueue = new Set();
const p = Promise.resolve();
let isFlushing = false;
function flushJob() {
  if (isFlushing) return;
  isFlushing = true;

  p.then(() => {
    jobQueue.forEach((job) => job());
  }).finally(() => {
    isFlushing = false;
  });
}

let activeEffect;
const effectStack = [];

function effect(fn, options) {
  const effectFn = () => {
    cleanup(effectFn);
    activeEffect = effectFn;
    effectStack.push(effectFn);
    const res = fn();
    effectStack.pop();
    activeEffect = effectStack[effectStack.length - 1];
    return res;
  };
  effectFn.options = options;
  effectFn.deps = [];

  if (!options.lazy) {
    effectFn();
  }

  return effectFn;
}

function cleanup(effectFn) {
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i];
    deps.delete(effectFn);
  }
  effectFn.deps.length = 0;
}

function computed(getter) {
  let value;
  let isDirty = true;
  const effectFn = effect(getter, {
    lazy: true,
    scheduler() {
      isDirty = true;
    },
  });

  const obj = {
    get value() {
      if (isDirty) {
        value = effectFn();
        isDirty = false;
      }
      return value;
    },
  };

  return obj;
}

const sum = computed(() => obj.foo + obj.bar);
console.log(sum.value);
obj.foo++;
console.log(sum.value);
