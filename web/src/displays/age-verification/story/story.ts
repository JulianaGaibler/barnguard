/**
 * The story the booth tells.
 *
 * Drafted by the policy team in a flowchart. The chart often puts several
 * paragraphs in one box, and here they are spread over a few screens so each
 * stays readable. Where the chart repeats a meeting for every order it can be
 * heard in, the story has it once and goes back to the meeting picker. Screens
 * marked "Placeholder" are stand-ins for text that has not been written yet.
 * Where the chart left an arrow loose, the link here follows the answer's
 * meaning, and each such answer is noted. The first screen is the splash, which
 * is in `i18n/en.ts`. See `web/docs/writing-a-story.md`.
 */
import { defineStory, type Condition } from './types'

// Both sets of meetings are heard in any order, once each. Each sets a flag,
// and the last screen of a meeting goes back to its picker, which shows the
// ones heard as taken, or leads on when all three have been.
const HEARD_ALL_ALTERNATIVES: Condition = {
  all: [{ flag: 'heard-cr' }, { flag: 'heard-dr' }, { flag: 'heard-yp' }],
}
const HEARD_ALL_GATES: Condition = {
  all: [{ flag: 'heard-sm' }, { flag: 'heard-pa' }, { flag: 'heard-av' }],
}

export const story = defineStory({
  start: 'role',
  nodes: {
    role: {
      kind: 'scene',
      body: [
        'You are a **policymaker**. It is **five months** until the election.',
        'One of the hot button issues is child online safety. Last year, Australia was the first country to implement a minimum age restriction on social media for children under the age of 16. Now, everyone seems to be following it.',
      ],
      next: 'staffer',
    },
    staffer: {
      kind: 'scene',
      body: [
        'You have your staffer prepare a brief about how to perform age checks.',
      ],
      next: 'proponents',
    },
    proponents: {
      kind: 'scene',
      title: 'Proponents of the ban',
      body: [
        'Proponents say that social media is harmful to children, and that children need to be protected from it. They argue that **checking age** is the best way to do it.',
        'It’s what we already do to make sure kids can’t gamble, buy alcohol, or watch porn. Why not do it for social media too?',
      ],
      next: 'opponents',
    },
    opponents: {
      kind: 'scene',
      title: 'Opponents of the ban',
      body: [
        'Opponents say that, while social media poses serious harms, it is also an important space for young people to access information, connect with others, and participate in public life.',
        'They say there are better ways to keep kids safe online by implementing **safety-by-design** to prevent harmful features, like personalized algorithms and targeted ads.',
      ],
      next: 'next-day',
    },
    'next-day': {
      kind: 'choice',
      body: [
        'The next day, your staffer asks you whether you want to pursue **age gates**, or whether you want to learn more about **alternatives**. What do you choose?',
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
        'Your staffer gives you a briefing about existing and novel approaches to regulating social media and other online platforms.',
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
        'Your staffer offers to arrange meetings with stakeholders who have ideas on how to fight online harms. Who do you want to meet first?',
      ],
      options: [
        {
          id: 'children',
          label: 'Child rights advocates',
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
      title: 'Child rights advocates',
      body: [
        'The child rights advocates explain that children have a right to participation, privacy, and play. These fundamental rights must be balanced in any policy.',
        'They argue that a blanket ban on social media violates young people’s rights to participate fully in public life.',
      ],
      next: 'cr-b',
    },
    'cr-b': {
      kind: 'scene',
      body: [
        'Instead, they advocate for regulating platform companies’ harmful behaviors at the design level. Dark patterns, personalized ads, and algorithmic feeds are just a few examples of manipulative design choices that social media companies deploy to keep kids online.',
      ],
      next: 'cr-c',
    },
    'cr-c': {
      kind: 'scene',
      body: [
        'The group also advocates for a holistic approach to improving youth mental health by resourcing both online and offline resources.',
        'They also stress the importance of child rights risk assessments, and the robust enforcement of privacy and platform governance rules.',
      ],
      next: [
        { when: HEARD_ALL_ALTERNATIVES, to: 'heard-everyone' },
        { to: 'stakeholders' },
      ],
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
          // The line names both other groups, so it shows only before either.
          when: { not: { any: [{ flag: 'heard-cr' }, { flag: 'heard-yp' }] } },
          text: 'You are convinced by their arguments, but you also want to hear from child rights advocates and young people.',
        },
      ],
      next: [
        { when: HEARD_ALL_ALTERNATIVES, to: 'heard-everyone' },
        { to: 'stakeholders' },
      ],
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
      ],
      next: [
        { when: HEARD_ALL_ALTERNATIVES, to: 'heard-everyone' },
        { to: 'stakeholders' },
      ],
    },
    'heard-everyone': {
      kind: 'scene',
      body: [
        'You have now heard from every group. All of them made really good points. You look at your staffer: “Do I have to pick one set of recommendations?”',
      ],
      next: 'lets-do-it',
    },
    'lets-do-it': {
      kind: 'scene',
      body: ['Your staffer smiles. “No, you don’t. Let’s do it all.”'],
      next: 'reelected',
    },
    reelected: {
      kind: 'scene',
      title: 'A year has passed',
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
        'Regulatory authorities are resourced, and existing rules are better enforced. Harmful design has been banned and people are no longer manipulated and steered to quantifiable outcomes.',
      ],
      next: 'law-platforms',
    },
    'law-platforms': {
      kind: 'scene',
      body: [
        'Online platforms have to conduct extensive child rights risk assessment and offer stronger default settings that meaningfully protect every user’s privacy and safety. When companies are caught deploying harmful features, they face heavy fines.',
      ],
      next: 'law-young-people',
    },
    'law-young-people': {
      kind: 'scene',
      body: [
        'Perhaps most importantly, the government has committed to funding offline resources to improve youth mental health.',
        'Funding for youth services has been increased to create local third spaces, provide quality media and tech education in schools, and offer anonymous support services online and offline.',
      ],
      next: 'hope',
    },
    hope: {
      kind: 'scene',
      body: [
        'The web might not be fixed yet, but your holistic approach to protecting everyone’s safety has laid the groundwork for creating a better Internet.',
        'Looking at the next generation, you have a new-found hope: **The kids are alright.**',
      ],
      next: 'reflect',
    },

    // ---------------------------------------------------------- age assurance
    'assurance-brief': {
      kind: 'scene',
      body: [
        'Your staffer gives you a briefing about age gating. You learn that there are different methods for understanding someone’s age online.',
        'The umbrella term for these methods is **“age assurance”**.',
      ],
      next: 'method-choice',
    },
    'method-choice': {
      kind: 'choice',
      presentation: 'folders',
      body: [
        'Your staffer offers to brief you on each of these options. You only have time for one today. Which one do you choose?',
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
      kind: 'scene',
      title: 'Age attestation',
      body: [
        'Your staffer mentions that age attestation can be **incorrect**, but that it gives parents an **active role**.',
      ],
      next: 'responsible',
    },
    estimation: {
      kind: 'scene',
      title: 'Age estimation',
      body: [
        'Platform companies use internal systems to guess a user’s age based on information collected about them, like selfies, voice, or browsing history.',
        'According to your staffer, it’s **not very accurate**, and it involves the use of **sensitive personal data**.',
        'On the upside: Social media companies have already collected all this data, why not use it for good?',
      ],
      // The chart's arrow is loose. It leads where attestation's does.
      next: 'responsible',
    },
    verification: {
      kind: 'scene',
      title: 'Age verification',
      body: [
        'Your staffer says it’s **very accurate**, but maybe concerning from a **privacy** perspective. Also, it turns out that not everyone has an ID or credit card.',
      ],
      // The chart has no arrow here yet. It leads where attestation's does.
      next: 'responsible',
    },
    responsible: {
      kind: 'choice',
      presentation: 'people',
      body: [
        'Now that you have learned more about different age assurance methods, you are wondering: Who should be responsible for implementing age gates?',
        'Your staffer offers to arrange briefing meetings with a number of stakeholders. Who do you meet first?',
      ],
      options: [
        {
          id: 'social-media',
          label: 'Social media companies',
          done: { flag: 'heard-sm' },
          sets: ['heard-sm'],
          next: 'sm-a',
        },
        {
          id: 'parents',
          label: 'Parents associations',
          done: { flag: 'heard-pa' },
          sets: ['heard-pa'],
          next: 'pa-a',
        },
        {
          id: 'vendors',
          label: 'Age assurance vendors',
          done: { flag: 'heard-av' },
          sets: ['heard-av'],
          next: 'av-a',
        },
      ],
    },
    'sm-a': {
      kind: 'scene',
      title: 'Social media companies',
      body: [
        'Social media companies range in size. The most famous ones are powerful, large companies with a global user base. Some may be lesser known but they are popular with children.',
      ],
      next: 'sm-b',
    },
    'sm-b': {
      kind: 'scene',
      body: [
        'Social media companies say that they want to prioritize users having a seamless experience without having to have their ages checked every time they log on. They propose having an age check at the **app store level**.',
        'Typically, kids access social media on their phones by downloading apps. So shouldn’t the app store be held responsible?',
      ],
      next: [{ when: HEARD_ALL_GATES, to: 'stack' }, { to: 'responsible' }],
    },
    'pa-a': {
      kind: 'scene',
      title: 'Parents associations',
      body: [
        'Parents associations represent parents who are deeply concerned about their children’s screen time. They claim that smartphones are impacting children’s ability to concentrate during school and be present during family time.',
      ],
      next: 'pa-b',
    },
    'pa-b': {
      kind: 'scene',
      body: [
        'Parents want a system that is as easy as possible. They propose having age checks at the **operating system (OS) level** so that kids’ devices check for age once and for all.',
        'Besides, if age checks happen at the device level, there’s no way of circumventing age restrictions anymore.',
      ],
      next: 'pa-c',
    },
    'pa-c': {
      kind: 'scene',
      body: [
        'They also propose linked accounts so that the accounts of parents and children are better connected. Parents need a way of knowing what their kids are up to!',
      ],
      next: [{ when: HEARD_ALL_GATES, to: 'stack' }, { to: 'responsible' }],
    },
    'av-a': {
      kind: 'scene',
      title: 'Age assurance vendors',
      body: [
        'Age assurance vendors are private companies that specialize in developing and implementing digital identity systems.',
        'They claim that they have developed a proprietary age estimation technology that estimates a user’s age based on biometric data, like a selfie or a voice recording. Some are already working with some social media companies to perform age checks.',
      ],
      next: 'av-b',
    },
    'av-b': {
      kind: 'scene',
      body: [
        'They say that all social media platforms are harmful to children, and should be required to have age checks at the **service level**.',
        'You feel like you can’t really argue with that.',
      ],
      next: [{ when: HEARD_ALL_GATES, to: 'stack' }, { to: 'responsible' }],
    },
    stack: {
      kind: 'choice',
      body: [
        'Now that you have heard from every stakeholder, it’s time to make a decision.',
        'Where in the stack should age assurance happen?',
      ],
      options: [
        {
          id: 'app-store',
          label: 'At the app store level',
          next: 'app-store-a',
        },
        {
          id: 'service',
          label: 'At the platform/service level',
          next: 'service-a',
        },
        {
          id: 'os',
          label: 'At the operating system level',
          next: 'os-a',
        },
      ],
    },
    'service-a': {
      kind: 'scene',
      title: 'Service level',
      body: [
        'You have decided to go with service-level age estimation. Your bill passes with overwhelming popular support from age assurance vendors.',
        'Digital rights advocates and technical experts vocally oppose your bill, but they are an outlier. Thanks to this bill, you are **re-elected**.',
      ],
      next: 'service-b',
    },
    'service-b': {
      kind: 'scene',
      body: [
        'The rollout occurs a year later. Social media platforms partner with age assurance vendors: some require selfies for facial analysis; some require voice recordings; and others use banking information to estimate the user’s age.',
      ],
      next: 'service-c',
    },
    'service-c': {
      kind: 'scene',
      body: [
        'The rollout is **disastrous**. There are stories of adults being locked out because of inaccurate facial analysis and children using generative AI to make themselves look older to bypass age checks.',
      ],
      next: 'service-d',
    },
    'service-d': {
      kind: 'scene',
      body: [
        'Shortly after the rollout, there is a major **data breach** of a popular age assurance vendor. Millions of people’s credit card information is compromised.',
        'Months later, there is a drastic uptick in cyberfraud complaints from children, adults, and the elderly.',
      ],
      next: 'reflect',
    },
    'app-store-a': {
      kind: 'scene',
      title: 'App store level',
      body: [
        'You have decided to go with app store level age assurance. Seen as a simple and clean solution, your bill passes with overwhelming popular support from social media companies.',
        'Digital rights advocates have warned about the negative effects of the bill on children and the open web, but their concerns seemed far-fetched.',
      ],
      next: 'app-store-b',
    },
    'app-store-b': {
      kind: 'scene',
      body: [
        'The rollout occurs a year later. App stores are forced to build new account infrastructure where every minor’s account has to be linked to a parent’s account.',
        'This leads to a few smaller app stores declaring bankruptcy: they can’t afford to set up this new structure.',
      ],
      next: 'app-store-c',
    },
    'app-store-c': {
      kind: 'scene',
      body: [
        'Only the two largest app stores remain. They also happen to be owned by large tech companies that also control operating systems.',
        'Thanks to the new account infrastructure, they now have access to more granular data about family connections: who is a parent, who is a child, who is a sibling, etc.',
      ],
      next: 'app-store-d',
    },
    'app-store-d': {
      kind: 'scene',
      body: [
        'They use this data to **profile users** and target them with highly specific ads about schools, pregnancy, menstruation, and unverified supplements, among others.',
      ],
      next: 'app-store-e',
    },
    'app-store-e': {
      kind: 'scene',
      body: [
        'The impact of age checks on the already vulnerable and marginalized youth is negative. LGBTQ youth are purposefully locked out of their accounts by their parents. Abusive parents use parental controls to surveil their children who are trying to seek help.',
        'In protest, young people start migrating to unregulated corners of the Internet to escape age checks.',
      ],
      next: 'reflect',
    },
    'os-a': {
      kind: 'scene',
      title: 'Operating system level',
      body: [
        'You have decided to go with OS-level age assurance. Surprisingly, there is vocal objection from age assurance vendors, but it passes with little pushback. Thanks to this bill, you are **re-elected**.',
      ],
      next: 'os-b',
    },
    'os-b': {
      kind: 'scene',
      body: [
        'A year later, it is finally the rollout day for operating system age assurance. Because of the massive political pressure, operating system providers have decided to implement **hard age verification**: users have to present a government-issued identification like passport or driver’s license to be able to unlock their devices.',
      ],
      next: 'os-c',
    },
    'os-c': {
      kind: 'scene',
      body: [
        'They claim that they can use a new, privacy-preserving technology called zero knowledge proofs to minimize the collection of other information.',
      ],
      next: 'os-d',
    },
    'os-d': {
      kind: 'scene',
      body: [
        'Within hours, social media is ablaze with stories about the disastrous rollout. Adults and children without government IDs are locked out of their school accounts, work emails, bank accounts, and other digital services that use social media to facilitate logging in.',
        'Particularly harmed are the undocumented, poor, and rural users.',
      ],
      next: 'os-e',
    },
    'os-e': {
      kind: 'scene',
      body: [
        'A few months later, the right-wing party in a neighboring country is elected into power. They pressure operating systems to disclose the age credentials of prominent activists and opposition leaders, essentially locking them out of the Internet.',
        'You are horrified to hear this, but that kind of stuff won’t happen in your country… right?',
      ],
      next: 'reflect',
    },

    // ---------------------------------------------------------------- closing
    // Every path ends here.
    reflect: {
      kind: 'ending',
      body: [
        'How did this game make you feel? What surprised you?',
        'How well did the solutions you chose address the problem you were solving for?',
      ],
    },
  },
})

export type StoryNodeId = keyof typeof story.nodes
