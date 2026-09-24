import {expect,it} from 'vitest';
import {DEFAULT_PREFERENCES,PreferencesSchema} from './types';

it('keeps legacy preferences and defaults only the new sound fields',()=>{
  const legacy={...DEFAULT_PREFERENCES,messages:true,leads:true,boardIds:['11111111-1111-4111-8111-111111111111'],sound:true,volume:undefined,soundType:undefined};
  expect(PreferencesSchema.parse(legacy)).toMatchObject({messages:true,leads:true,boardIds:legacy.boardIds,sound:true,volume:40,soundType:'current'});
});

it('validates the supported sound and volume range',()=>{
  expect(PreferencesSchema.safeParse({...DEFAULT_PREFERENCES,volume:0}).success).toBe(true);
  expect(PreferencesSchema.safeParse({...DEFAULT_PREFERENCES,volume:101}).success).toBe(false);
  expect(PreferencesSchema.safeParse({...DEFAULT_PREFERENCES,soundType:'unknown'}).success).toBe(false);
});
