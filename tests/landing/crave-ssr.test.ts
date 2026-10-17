import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CraveScene} from '../../components/landing/CraveScene';
import {FieldGuide} from '../../components/landing/FieldGuide';

describe('crave server rendering',()=>{
  it('reserves the motion control before hydration without exposing an inactive button',()=>{
    const html=renderToStaticMarkup(createElement(CraveScene,{textureAlt:'Texture',crossAlt:'Cross section',stillLabel:'Still',motionLabel:'Motion'}));
    expect(html).toContain('landing-v2-crave-control-slot');
    expect(html).not.toContain('<button');
    expect(html).toContain('data-motion="pending"');
  });
  it('exposes a named ingredient group to assistive technology',()=>{
    const html=renderToStaticMarkup(createElement(FieldGuide,{language:'en'}));
    expect(html).toContain('role="group" aria-labelledby="field-guide-labels-title"');
    expect(html).toContain('id="field-guide-labels-title"');
  });
});
