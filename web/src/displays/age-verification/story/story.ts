/**
 * The story the booth tells.
 *
 * Drafted by the policy team in a flowchart, and still unfinished. Screens
 * marked "Placeholder" are stand-ins for text that has not been written yet.
 * Where the chart left an arrow loose, the link here follows the answer's
 * meaning, and each such answer is noted. The first screen is the splash, which
 * is in `i18n/en.ts`. See `web/docs/writing-a-story.md`.
 */
import { defineStory } from './types'

export const story = defineStory({
  start: 'role',
  nodes: {
    role: {
      kind: 'scene',
      body: [
        'You play an elected lawmaker. Parents in your district demand action on how their kids are exposed to social media.',
        'Your party expects a bill from your office by September, and your next election is in November.',
        'You make choices and see what they lead to. There is no right answer.',
      ],
      next: 'brief',
    },
    brief: {
      kind: 'scene',
      body: [
        'October 29th. 5 months until the election.',
        'Your staffer, Dana, prepares a brief on online child safety.',
        'Experts disagree on the best solutions. Some stress the need for knowing users’ ages. Others argue that there are better ways to make kids safer online.',
      ],
      next: 'documentary',
    },
    documentary: {
      kind: 'choice',
      body: [
        'That evening, your wife, Sam, tells you about a documentary she has watched about social media addiction. It sounds bad.',
        'The next day, Dana asks you whether you want to pursue age gates, or whether you want to learn more about alternatives. What do you choose?',
      ],
      options: [
        {
          id: 'pursue',
          label: 'Pursue age assurance',
          next: 'assurance-brief',
        },
        {
          id: 'alternatives',
          label: 'Learn more about alternatives.',
          next: 'alternatives',
        },
      ],
    },
    // The chart does not continue past this answer.
    alternatives: {
      kind: 'moment',
      body: [
        'Placeholder: Dana briefs you on alternatives to age gates. You decide to look at age assurance first.',
      ],
      next: 'assurance-brief',
    },
    'assurance-brief': {
      kind: 'scene',
      body: [
        'Dana gives you a briefing about age gating. You learn that there are different methods for understanding someone’s age online. The umbrella term for these methods is “age assurance”.',
      ],
      next: 'methods',
    },
    methods: {
      kind: 'scene',
      body: [
        'Age attestation: A user attests to their own age, or the age of someone they know.',
        'Age estimation: Software guesses a user’s age based on a selfie, their voice, or browsing history.',
        'Age verification: A user proves their age with an ID, credit card or other official documents.',
      ],
      next: 'method-choice',
    },
    'method-choice': {
      kind: 'choice',
      body: [
        'Dana offers to brief you on each of these options. You only got time for one today. Which one do you choose?',
      ],
      options: [
        { id: 'attestation', label: 'Age attestation', next: 'attestation' },
        { id: 'estimation', label: 'Age estimation', next: 'estimation' },
        { id: 'verification', label: 'Age verification', next: 'verification' },
      ],
    },

    // ------------------------------------------------------------ attestation
    attestation: {
      kind: 'choice',
      body: [
        'Age attestation. Dana mentions that age attestation can be incorrect, but that it gives parents an active role.',
        'She offers to arrange meetings with the groups you want to hear from. You have time for one this week. Who do you choose?',
      ],
      options: [
        { id: 'parents', label: 'Parents associations', next: 'parents' },
        { id: 'vendors', label: 'Age assurance vendors', next: 'vendors' },
        {
          id: 'child-protection',
          label: 'Child protection organization',
          next: 'child-protection',
        },
      ],
    },
    parents: {
      kind: 'choice',
      body: [
        'Parents association. You hear that parents want to take an active role in their kids’ lives, but that attesting to their kids’ age must be as easy as possible, ideally when they set up their devices.',
      ],
      options: [
        {
          id: 'convinced',
          label:
            'You are convinced: Age assurance should happen at the device level.',
          next: 'device-level',
        },
        {
          // The chart's arrow goes to the vendors' pitch for estimation.
          id: 'not-convinced',
          label:
            'You’re not convinced and want to learn more about age estimation.',
          next: 'vendors',
        },
      ],
    },
    'child-protection': {
      kind: 'choice',
      body: [
        'Child protection organization. You hear that age assurance is not robust enough, and that parents are not to be trusted. Every social media platform should make sure that no child can access it.',
      ],
      options: [
        {
          // The chart has no label on these two arrows.
          id: 'not-convinced',
          label: 'You’re not convinced.',
          next: 'device-level',
        },
        {
          id: 'agree',
          label:
            'You agree: Social media should be responsible for age assurance.',
          next: 'estimation-way',
        },
      ],
    },

    // ------------------------------------------------------------- estimation
    estimation: {
      kind: 'choice',
      body: [
        'Age estimation. According to Dana, it’s not very accurate, and users have to hand over lots of data. On the upside: Anyone can take a selfie.',
        'She offers to arrange meetings with the groups you want to hear from. You have time for one this week. Who do you choose?',
      ],
      options: [
        {
          id: 'digital-rights',
          label: 'Digital rights advocates',
          next: 'digital-rights-estimation',
        },
        { id: 'vendors', label: 'Age assurance vendors', next: 'vendors' },
        {
          id: 'social-media',
          label: 'Big social media platform',
          next: 'social-media',
        },
      ],
    },
    // Reached from attestation, estimation and the parents' meeting, where the
    // chart repeats it with the same text.
    vendors: {
      kind: 'choice',
      body: [
        'Age assurance vendors. You hear that age attestation is not robust enough, and that it is crucial to be extremely sure of someone’s age online. Luckily, they offer age estimation solutions that can do the job.',
      ],
      options: [
        {
          id: 'intrigued',
          label: 'You’re intrigued. This is the way to go.',
          next: 'estimation-way',
        },
        {
          id: 'civil-society',
          label: 'You’re wondering what civil society has to say.',
          next: 'digital-rights-estimation',
        },
      ],
    },
    'digital-rights-estimation': {
      kind: 'choice',
      body: [
        'Digital rights advocates. You learn that age estimation providers get breached all the time and that it’s really bad for people’s privacy and security.',
      ],
      options: [
        {
          id: 'shocked',
          label: 'You are shocked. This can’t be the solution!',
          next: 'device-level',
        },
        {
          id: 'overblown',
          label: 'You think the concerns are overblown.',
          next: 'estimation-way',
        },
      ],
    },
    'social-media': {
      kind: 'choice',
      body: [
        'Big social media platform. They support your goals, but they also think that others should do age assurance. Surely, devices and app stores are much better placed to understand everyone’s age?',
      ],
      options: [
        {
          id: 'point',
          label: 'They have a point.',
          next: 'device-level',
        },
        {
          id: 'harm',
          label:
            'Social media is where the harm occurs - they should be responsible.',
          next: 'estimation-way',
        },
      ],
    },

    // ----------------------------------------------------------- verification
    verification: {
      kind: 'choice',
      body: [
        'Age verification. Dana says it’s very accurate, but maybe concerning from a privacy perspective. Also, it turns out that not everyone has an ID or credit card.',
        'She offers to arrange meetings with the groups you want to hear from. You have time for one this week. Who do you choose?',
      ],
      options: [
        {
          id: 'digital-rights',
          label: 'Digital rights advocates',
          next: 'digital-rights-verification',
        },
        { id: 'bank', label: 'A big bank', next: 'bank' },
        { id: 'tech', label: 'A large tech company', next: 'tech-company' },
      ],
    },
    'digital-rights-verification': {
      kind: 'choice',
      body: [
        'Digital rights advocates. You learn that it is possible to solve privacy concerns around age verification, but that it’s very inaccessible to lots of people.',
      ],
      options: [
        {
          // The chart sends the whole screen to "Age verification is the way
          // to go". Only the second answer does here.
          id: 'shocked',
          label: 'You are shocked. This can’t be the solution!',
          next: 'device-level',
        },
        {
          id: 'overblown',
          label: 'You think the concerns are overblown.',
          next: 'verification-way',
        },
      ],
    },
    bank: {
      kind: 'choice',
      body: [
        'A big bank. You hear that age verification is possible, and that they are your partner in this. Problem solved!',
      ],
      options: [
        {
          id: 'way-forward',
          label: 'This is the way forward.',
          next: 'verification-way',
        },
        {
          id: 'worried',
          label: 'You are worried about people who don’t have bank accounts.',
          next: 'device-level',
        },
      ],
    },
    'tech-company': {
      kind: 'choice',
      body: [
        'Large tech company. You hear that this company controls an operating system, an app store, a digital wallet and a social media platform. Putting age verification into their hands will be easy and seamless.',
      ],
      options: [
        {
          id: 'great',
          label: 'This is great!',
          next: 'verification-way',
        },
        {
          id: 'distrust',
          label:
            'You don’t trust them and think that social media should be responsible for age assurance.',
          next: 'estimation-way',
        },
      ],
    },

    // ------------------------------------------------- where the chart stops
    'device-level': {
      kind: 'choice',
      body: [
        'You have decided that age assurance should happen at the device level. Now the question is: How much confidence in an age signal is needed?',
      ],
      options: [
        {
          id: 'attestation-enough',
          label: 'Age attestation is enough.',
          next: 'attestation-way',
        },
        {
          id: 'verify',
          label: 'Age needs to be verified.',
          next: 'verification-way',
        },
      ],
    },
    // Placeholder endings. The chart has no outcomes yet.
    'attestation-way': {
      kind: 'ending',
      title: 'Placeholder: age attestation',
      body: ['You have decided that age attestation is enough.'],
    },
    'estimation-way': {
      kind: 'ending',
      title: 'Placeholder: age estimation',
      body: [
        'You have decided that age estimation is the way to go. It seems logical that social media platforms are the ones that should implement age estimation.',
      ],
    },
    'verification-way': {
      kind: 'ending',
      title: 'Placeholder: age verification',
      body: ['Age verification is the way to go.'],
    },
  },
})

export type StoryNodeId = keyof typeof story.nodes
