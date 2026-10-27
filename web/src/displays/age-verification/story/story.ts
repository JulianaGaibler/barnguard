/**
 * The story the booth tells.
 *
 * Drafted by the policy team in a flowchart, and still unfinished. Screens
 * marked "Placeholder" are stand-ins for text that has not been written yet.
 * Where the chart left an arrow loose, the link here follows the answer's
 * meaning, and each such answer is noted. The first screen is the splash, which
 * is in `i18n/en.ts`. See `web/docs/writing-a-story.md`.
 */
import { defineStory, type Condition } from './types'

// The three expert meetings are heard in any order, once each. Each sets a
// flag, and the last screen of a meeting offers the ones not heard yet, or
// Continue when all three have been.
const HEARD_ALL: Condition = {
  all: [{ flag: 'heard-cr' }, { flag: 'heard-dr' }, { flag: 'heard-yp' }],
}
const NOT_ALL_HEARD: Condition = { not: HEARD_ALL }

export const story = defineStory({
  start: 'role',
  nodes: {
    role: {
      kind: 'scene',
      body: [
        'You play an **elected lawmaker**. Parents in your district demand action on how their kids are exposed to social media.',
        'Your party expects a bill from your office by September, and your next election is in November.',
        'You make choices and see what they lead to. There is no right answer.',
      ],
      next: 'brief',
    },
    brief: {
      kind: 'scene',
      title: 'October 29th',
      body: [
        '**5 months** until the election.',
        'One of the hot button issues has been child online safety, as many jurisdictions rush to enact minimum age restrictions on social media platforms.',
      ],
      next: 'staffer',
    },
    staffer: {
      kind: 'scene',
      body: [
        'Your staffer, Dana, prepares a brief on online child safety.',
        'Experts disagree on the best solutions. Some stress the need for **knowing users’ ages**. Others argue that there are **better ways** to make kids safer online.',
      ],
      next: 'documentary',
    },
    documentary: {
      kind: 'choice',
      body: [
        'That evening, your wife, Sam, tells you about a documentary she has watched about social media addiction. It sounds bad.',
        'The next day, Dana asks you whether you want to pursue **age gates**, or whether you want to learn more about **alternatives**. What do you choose?',
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
    // ------------------------------------------------------- alternatives
    alternatives: {
      kind: 'scene',
      body: [
        'Dana gives you a briefing about existing and novel approaches to regulating social media and other online platforms.',
        'You learn that many jurisdictions already have **regulatory frameworks** in place to hold online platforms accountable and give their users more rights.',
      ],
      next: 'dsa',
    },
    dsa: {
      kind: 'scene',
      body: [
        'In Europe, for example, the **Digital Services Act** requires platforms to:',
        '- moderate content',
        '- make sure that their terms respect fundamental rights',
        '- analyze and mitigate risks stemming from their services',
        '- offer users avenues for redress in case of wrongful take downs or account suspensions',
      ],
      next: 'dsa-young-people',
    },
    'dsa-young-people': {
      kind: 'choice',
      body: [
        'The Digital Services Act also includes specific requirements to ensure **young people’s privacy, security and safety**, which includes a ban on targeting kids for advertising.',
        'But clearly, online platforms are still not always safe spaces for young people.',
      ],
      options: [
        { id: 'else', label: 'What else can be done?', next: 'stakeholders' },
        {
          // The chart's arrow goes back to the age assurance briefing.
          id: 'never-mind',
          label: 'Never mind, I want to pursue age assurance.',
          next: 'assurance-brief',
        },
      ],
    },
    stakeholders: {
      kind: 'choice',
      presentation: 'people',
      body: [
        'Dana offers to arrange meetings with stakeholders who have ideas on how to fight online harms. Who do you want to meet first?',
      ],
      options: [
        {
          id: 'children',
          label: 'Children’s rights experts',
          done: { flag: 'heard-cr' },
          sets: ['heard-cr'],
          next: 'cr-a',
        },
        {
          id: 'digital-rights',
          label: 'Digital rights advocates',
          done: { flag: 'heard-dr' },
          sets: ['heard-dr'],
          next: 'dr-a',
        },
        {
          id: 'young-people',
          label: 'Young people',
          done: { flag: 'heard-yp' },
          sets: ['heard-yp'],
          next: 'yp-a',
        },
      ],
    },
    'cr-a': {
      kind: 'scene',
      title: 'Children’s rights experts',
      body: [
        'The children’s rights group explains that children’s rights to information, participation, education, and play, among others, must be the starting point of any intervention. They argue that a blanket social media ban would fall short of respecting young people’s rights and being proportionate.',
      ],
      next: 'cr-b',
    },
    'cr-b': {
      kind: 'scene',
      body: [
        'Instead, they advocate for banning harmful design and features, to make all online services appropriate for children. The group also advocates for online and offline alternatives for children to offer them spaces where they can explore themselves and the world.',
      ],
      next: 'cr-c',
    },
    'cr-c': {
      kind: 'scene',
      body: [
        'They also stress the importance of child rights risk assessments, and the robust enforcement of privacy and platform governance rules.',
        {
          when: NOT_ALL_HEARD,
          text: 'You are intrigued. But you’ve also heard that children’s rights and digital rights groups often disagree, so you want to hear what they have to say. And is anyone talking to the kids?',
        },
      ],
      next: [{ when: HEARD_ALL, to: 'heard-everyone' }, { to: 'stakeholders' }],
    },
    'dr-a': {
      kind: 'scene',
      title: 'Digital rights advocates',
      body: [
        'The experts you are talking to are asking a fundamental question: What is the root cause of online harms? Their answer: Big tech’s business model that’s based on extracting as much attention and data from people as possible.',
      ],
      next: 'dr-b',
    },
    'dr-b': {
      kind: 'scene',
      body: [
        'Therefore, they propose to ban personalized ads, limit much more strictly how companies can use personal data to personalize recommendations or ads, mandate privacy-protective settings by default, giving users more control over their online experiences, and to take down data brokers.',
      ],
      next: 'dr-c',
    },
    'dr-c': {
      kind: 'scene',
      body: [
        'They also emphasize how harmful design can manipulate users, and call to ban deceptive and manipulative design.',
        {
          when: NOT_ALL_HEARD,
          text: 'You are convinced by their arguments, but you also want to hear from children’s rights groups and young people.',
        },
      ],
      next: [{ when: HEARD_ALL, to: 'heard-everyone' }, { to: 'stakeholders' }],
    },
    'yp-a': {
      kind: 'scene',
      title: 'Young people',
      body: [
        'You are talking to a youth group, and are shocked to hear that young people themselves are almost never asked – or heard – when it comes to political decisions that affect them and their lives.',
      ],
      next: 'yp-b',
    },
    'yp-b': {
      kind: 'scene',
      body: [
        'They say that rather than banning young people from online platforms, policymakers should ban online platforms from deploying harmful features and design choices. They want spaces to explore, learn and play, without being exploited by platforms’ business models.',
      ],
      next: 'yp-c',
    },
    'yp-c': {
      kind: 'scene',
      body: [
        'They also stress that platforms should be held accountable under existing laws, that policymakers should fund and expand spaces for young people, and finally include them in decision making processes that affect them.',
        {
          when: NOT_ALL_HEARD,
          text: 'You’re impressed. You’re still curious what others have to say.',
        },
      ],
      next: [{ when: HEARD_ALL, to: 'heard-everyone' }, { to: 'stakeholders' }],
    },
    'heard-everyone': {
      kind: 'scene',
      body: [
        'You have now heard from every group. All of them made really good points. You look at Dana: “Do I have to pick one set of recommendations?”',
      ],
      next: 'lets-do-it',
    },
    'lets-do-it': {
      kind: 'scene',
      body: ['Dana smiles. “No, you don’t. Let’s do it all.”'],
      next: 'reelected',
    },
    reelected: {
      kind: 'scene',
      title: 'March 2027',
      body: [
        'You have won your re-election with a comfortable margin. People liked the **holistic approach** you took to online safety. Rather than promising an easy fix, you were honest about the fact that this is a tough problem – that requires more than one solution.',
      ],
      next: 'law',
    },
    law: {
      kind: 'scene',
      body: [
        'Your “Let’s fix the web” law has entered into force, and results are looking promising.',
      ],
      next: 'law-enforcement',
    },
    'law-enforcement': {
      kind: 'scene',
      body: [
        'Regulatory authorities have been beefed up, and existing rules are better enforced. Harmful design has been banned and people are no longer manipulated and steered to quantifiable outcomes.',
      ],
      next: 'law-platforms',
    },
    'law-platforms': {
      kind: 'scene',
      body: [
        'Online platforms have to conduct extensive child rights risk assessment and no longer offer harmful features. Default settings protect users’ privacy and people have granular controls at their disposal to shape their online experiences.',
      ],
      next: 'law-young-people',
    },
    'law-young-people': {
      kind: 'scene',
      body: [
        'Perhaps most importantly, the government has committed to fund offline and online alternatives and spaces for young people, and to include them in and decision making process that affects them, their lives and their futures.',
      ],
      next: 'hope',
    },
    hope: {
      kind: 'ending',
      body: [
        'The web might not be fixed yet. But you are proud of what you have achieved. Looking at the next generation, you have a new-found hope: **The kids are alright.**',
      ],
    },

    'assurance-brief': {
      kind: 'scene',
      body: [
        'Dana gives you a briefing about age gating. You learn that there are different methods for understanding someone’s age online.',
        'The umbrella term for these methods is **“age assurance”**.',
      ],
      next: 'method-choice',
    },
    'method-choice': {
      kind: 'choice',
      presentation: 'folders',
      body: [
        'Dana offers to brief you on each of these options. You only have time for one today. Which one do you choose?',
      ],
      options: [
        {
          id: 'attestation',
          label: 'Age attestation',
          description:
            'A user attests to their own age, or the age of someone they know.',
          next: 'attestation',
        },
        {
          id: 'estimation',
          label: 'Age estimation',
          description:
            'Software guesses a user’s age based on a selfie, their voice, or browsing history.',
          next: 'estimation',
        },
        {
          id: 'verification',
          label: 'Age verification',
          description:
            'A user proves their age with an ID, credit card or other official documents.',
          next: 'verification',
        },
      ],
    },
    attestation: {
      kind: 'choice',
      title: 'Age attestation',
      presentation: 'people',
      body: [
        'Dana mentions that age attestation can be **incorrect**, but that it gives parents an **active role**.',
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
      title: 'Parents association',
      body: [
        'You hear that parents want to take an active role in their kids’ lives, but that attesting to their kids’ age must be as easy as possible, ideally when they set up their devices.',
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
      title: 'Child protection organization',
      body: [
        'You hear that age assurance is not robust enough, and that parents are not to be trusted. Every social media platform should make sure that no child can access it.',
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
      title: 'Age estimation',
      presentation: 'people',
      body: [
        'According to Dana, it’s **not very accurate**, and users have to hand over **lots of data**. On the upside: Anyone can take a selfie.',
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
      title: 'Age assurance vendors',
      body: [
        'You hear that age attestation is not robust enough, and that it is crucial to be extremely sure of someone’s age online. Luckily, they offer age estimation solutions that can do the job.',
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
      title: 'Digital rights advocates',
      body: [
        'You learn that age estimation providers get breached all the time and that it’s really bad for people’s privacy and security.',
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
      title: 'Big social media platform',
      body: [
        'They support your goals, but they also think that others should do age assurance. Surely, devices and app stores are much better placed to understand everyone’s age?',
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
      title: 'Age verification',
      presentation: 'people',
      body: [
        'Dana says it’s **very accurate**, but maybe concerning from a **privacy** perspective. Also, it turns out that not everyone has an ID or credit card.',
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
      title: 'Digital rights advocates',
      body: [
        'You learn that it is possible to solve privacy concerns around age verification, but that it’s very inaccessible to lots of people.',
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
      title: 'A big bank',
      body: [
        'You hear that age verification is possible, and that they are your partner in this. Problem solved!',
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
      title: 'Large tech company',
      body: [
        'You hear that this company controls an operating system, an app store, a digital wallet and a social media platform. Putting age verification into their hands will be easy and seamless.',
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
    // Placeholder ending. The chart has no outcome for it yet.
    'attestation-way': {
      kind: 'ending',
      body: ['Placeholder: age attestation.'],
    },
    'estimation-way': {
      kind: 'ending',
      body: [
        'You have decided that age estimation is the way to go. It seems logical that social media platforms are the ones that should implement age estimation.',
      ],
    },
    'verification-way': {
      kind: 'ending',
      body: ['Age verification is the way to go.'],
    },
  },
})

export type StoryNodeId = keyof typeof story.nodes
