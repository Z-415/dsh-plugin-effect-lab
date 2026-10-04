window.__ModuleLoader__.load({
  id: 'dsh-lab-dup-slot-two',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function Decoration() {
      return h('span', {
        'data-lab-dup-slot': 'two',
        style: {
          display: 'inline-block',
          width: '6px',
          height: '6px',
          marginLeft: '4px',
          borderRadius: '3px',
          background: '#ff6633',
        },
      });
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'lab-dup-decoration',
          order: 6,
        }, Decoration));
        ctx.effect(() => {
          document.documentElement.style.setProperty('--lab-dup-slot', 'two');
          return () => document.documentElement.style.removeProperty('--lab-dup-slot');
        });
      },
    };
  },
});
