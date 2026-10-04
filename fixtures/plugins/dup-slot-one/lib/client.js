window.__ModuleLoader__.load({
  id: 'dsh-lab-dup-slot-one',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function Decoration() {
      return h('span', {
        'data-lab-dup-slot': 'one',
        style: {
          display: 'inline-block',
          width: '6px',
          height: '6px',
          marginLeft: '4px',
          borderRadius: '3px',
          background: '#3366ff',
        },
      });
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'lab-dup-decoration',
          order: 5,
        }, Decoration));
        ctx.effect(() => {
          document.documentElement.style.setProperty('--lab-dup-slot', 'one');
          return () => document.documentElement.style.removeProperty('--lab-dup-slot');
        });
      },
    };
  },
});
