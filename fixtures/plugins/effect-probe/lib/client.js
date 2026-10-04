window.__ModuleLoader__.load({
  id: 'dsh-lab-effect-probe',
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
    exports.inject = [];
    exports.apply = () => {
      document.documentElement.style.setProperty('--lab-effect-probe-color', '#3366ff');
      document.body?.setAttribute('data-lab-effect-probe', 'one');
    };
    exports.dispose = () => {
      document.documentElement.style.removeProperty('--lab-effect-probe-color');
      document.body?.removeAttribute('data-lab-effect-probe');
    };
    return module.exports;
  },
});
