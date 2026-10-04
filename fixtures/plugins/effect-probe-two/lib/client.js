window.__ModuleLoader__.load({
  id: 'dsh-lab-effect-probe-two',
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
    exports.inject = [];
    exports.apply = () => {
      document.documentElement.style.setProperty('--lab-effect-probe-color', '#ff6633');
      document.body?.setAttribute('data-lab-effect-probe-two', 'two');
    };
    exports.dispose = () => {
      document.documentElement.style.removeProperty('--lab-effect-probe-color');
      document.body?.removeAttribute('data-lab-effect-probe-two');
    };
    return module.exports;
  },
});
