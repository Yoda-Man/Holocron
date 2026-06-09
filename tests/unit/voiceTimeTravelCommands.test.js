/**
 * voiceTimeTravelCommands.test.js — Time-travel voice grammar tests
 */

import VoiceCommands from '../../frontend/voiceCommands.js';

describe('Voice time-travel commands', () => {
  test('parses last week changes command', () => {
    const voice = new VoiceCommands({ enabled: false });
    expect(voice.parseCommand("Show me last week's changes")).toEqual({
      action: 'timeTravelLastWeek',
      param: undefined,
    });
  });

  test('parses day-specific change command', () => {
    const voice = new VoiceCommands({ enabled: false });
    expect(voice.parseCommand('What changed on Tuesday?')).toEqual({
      action: 'timeTravelDate',
      param: 'tuesday',
    });
  });

  test('parses file evolution command', () => {
    const voice = new VoiceCommands({ enabled: false });
    expect(voice.parseCommand('Show evolution of AuthService')).toEqual({
      action: 'timeTravelEvolution',
      param: 'authservice',
    });
  });
});
