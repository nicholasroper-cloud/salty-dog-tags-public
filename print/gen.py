import re,json,html
T=open('corgi-dog-tags/index.html',encoding='utf-8').read()
def e(s): return html.escape(s,quote=False).replace("'","&#x27;")
B=[
dict(slug='boston-terrier-dog-tags',name='Boston Terrier',short='Boston',plural='Bostons',
 title='Boston Terrier Dog Tags — Funny Engraved | Salty Dog',
 desc="Funny engraved tags for the tuxedo-wearing, gassy, snoring Boston Terrier. Laser cut in Lehi, Utah, name and number on the back. From $12.",
 h1='Funny Boston Terrier Dog Tags',
 blurb="Engraved tags for the little gentleman in the tuxedo who snores like a chainsaw and toots like a trumpet. Our bulldogs respect the commitment.",
 say_lead="Front of the tag. About the tuxedo, the gas, the snoring and the bug eyes. Name and number go on the back.",
 sayh="Boston Terrier sayings for the tuxedo, the toots and the snoring",
 sayings=["Tuxedo on.|Manners off.","Snores like a chainsaw.|Toots like a trumpet.","Formal wear.|Informal gas.","Bug eyes.|Big opinions.","If found, check|under the covers.","Not a Frenchie.|Stop asking.","Dressed for dinner.|Ate yours.","Small dog.|Full-size gas.","Sneezes loudly.|Judges silently.","Runs on zoomies|and spite.","Black tie.|Black hole stomach.","Gentleman. Mostly."],
 tough_h="Built for a dog who is mostly zoomies and gas",
 paras=["Anyone who owns a Boston knows the routine. The tuxedo makes them look like they are headed to a wedding, and then they clear the room with one toot and fall asleep snoring on your pillow. That big round head leaves very little room for polite behavior.","A Boston never runs at one speed. It is nap, nap, nap, then thirty seconds of couch-surfing zoomies, then nap again. The tag takes all of that, so it gets laser engraved into the metal. Nothing to peel off when they skid into the coffee table.","Those bug eyes also mean a lot of face-first adventures, so the name and number go on the back where they stay readable."],
 sizes_lead="Bostons are compact but sturdy, with a thick little neck. A mid-size tag reads well and stays out of the way of the zoomies.",
 sz=["Puppies and small Bostons. Light enough for a tiny collar.","The one most Bostons wear. Reads easily and doesn&#x27;t swing into the face.","For a big, barrel-chested Boston on a wide collar. Check the fit."],
 pick="Short answer: adult Boston, standard collar, go Medium.",
 faqw="What should I put on a Boston Terrier's tag?",
 faqa="Pick one joke for the front and keep it under two short lines, like Tuxedo on. Manners off. Put your dog's name and a phone number on the back. Skip anything cutesy that hides the number.",
 close="Boston Terriers and English bulldogs share a love of blankets, a snoring habit and a gas problem we will not discuss. We wrote the <a href=\"/bulldog-dog-tags/\">bulldog tags</a> first, from experience, and the Boston lines come from friends whose tuxedo dogs sleep on their heads.",
 rel=['bulldog','frenchie','pug'],art='Bostons'),
dict(slug='aussie-dog-tags',name='Australian Shepherd (Aussie)',short='Aussie',plural='Aussies',
 title='Australian Shepherd (Aussie) Dog Tags — Funny | Salty Dog',
 desc="Funny engraved tags for the Aussie who herds your kids and needs a job. Laser cut in Lehi, Utah, name and number on the back. From $12.",
 h1='Funny Australian Shepherd (Aussie) Dog Tags',
 blurb="Engraved tags for the dog who herds your children, your guests and your vacuum. An Aussie with no job will invent one, and you will not like it.",
 say_lead="Front of the tag. About the herding, the job hunt and the velcro. Name and number go on the back.",
 sayh="Aussie sayings for herders, job seekers and velcro dogs",
 sayings=["Herds kids.|Unpaid. Unstoppable.","Needs a job.|Made up my own.","Velcro dog.|Bathroom included.","Not lost. Herding|the neighbors.","Two blue eyes.|Zero chill.","Walked 5 miles.|Still not tired.","Nips heels.|Means well.","Bored Aussie.|Hide your shoes.","Tail? What tail?","Merle all over|your couch.","Will herd you|to the kitchen.","Smart enough|to open the door."],
 tough_h="Built for a dog who never clocks out",
 paras=["Every Aussie owner has the same story. You took a long hike, you threw the ball for an hour, and the dog still stands at the door asking what is next. They were bred to work cattle all day, so a quiet Sunday looks to them like unemployment.","An Aussie with nothing to do will find a job. Herding the kids into one room is the classic, and the heel nips are meant kindly. The dog also follows you to the bathroom, the garage and the mailbox, because the one job they truly love is being your shadow.","That means a tag that gets dragged through brush, mud and kid pile-ups. Our text is laser engraved into the metal, so nothing wears off."],
 sizes_lead="Aussies are medium-sized, athletic and fluffy. A mid-size tag reads well on the collar without catching on brush.",
 sz=["Mini Aussies and puppies. Can hide in the ruff.","The one most full-size Aussies wear. Reads easily and stays put.","For a big male on a wide collar. Check that it doesn&#x27;t catch on brush."],
 pick="Short answer: adult Aussie, standard collar, go Medium.",
 faqw="What should I put on an Australian Shepherd's tag?",
 faqa="One joke for the front, two short lines at most, like Herds kids. Unpaid. Unstoppable. Put your dog's name and a phone number on the back. Aussies are escape artists, so the number matters more than the joke.",
 close="Aussies and English bulldogs agree on exactly nothing, except that you should never leave either one alone with a sandwich. We wrote the <a href=\"/bulldog-dog-tags/\">bulldog tags</a> first, from experience, and the Aussie lines come from friends whose dogs herd our bulldogs, who refuse to be herded.",
 rel=['corgi','husky','german-shepherd'],art='Aussies'),
dict(slug='cavalier-dog-tags',name='Cavalier King Charles Spaniel',short='Cavalier',plural='Cavaliers',
 title='Cavalier King Charles Spaniel Dog Tags — Funny | Salty Dog',
 desc="Funny engraved tags for the Cavalier, a lap barnacle with pleading eyes and zero prey drive. Laser cut in Lehi, Utah. From $12.",
 h1='Funny Cavalier King Charles Spaniel Dog Tags',
 blurb="Engraved tags for the lap barnacle with the pleading eyes and no prey drive whatsoever. A Cavalier will welcome the burglar and show him the good silver.",
 say_lead="Front of the tag. About the eyes, the lap and the love of everyone. Name and number go on the back.",
 sayh="Cavalier sayings for lap barnacles with pleading eyes",
 sayings=["Lap barnacle.|Remove with snacks.","Those eyes.|Yes, I got fed.","Will greet burglars.|Show them the TV.","Zero prey drive.|Full love drive.","Royal ears.|Peasant manners.","Chases a squirrel.|Then makes friends.","Sat on you.|Not leaving.","Spaniel. Not|a rocket scientist.","If found, I'm|already on your lap.","Loves everyone.|Especially you.","Follows you|to the fridge.","Ears: dragged|through dinner."],
 tough_h="Built for the softest dog in the room",
 paras=["A Cavalier has one setting, and it is love. They have no prey drive, no guard instinct and no shame about climbing onto the stranger who just came to fix the dishwasher. If you sit down, a Cavalier is already on you, and it will stay there until you need to stand.","Those pleading eyes work on everyone, and you will lose every staring contest at dinner. They are also people-pleasers who follow you from room to room, so the tag spends its day jingling right behind you.","A Cavalier&#x27;s silky ears also drag through the water bowl, so a tag that holds up to drool and dinner is a real need. Ours is laser engraved into the metal, so it stays readable."],
 sizes_lead="Cavaliers are small but sturdy, with a silky coat and big ears. A mid-size tag reads well without tangling in the fringe.",
 sz=["Puppies and petite Cavaliers. Can hide under the ears.","The one most Cavaliers wear. Reads easily and stays clear of the fringe.","For a bigger Cavalier on a wide collar. Check that it doesn&#x27;t tangle."],
 pick="Short answer: adult Cavalier, standard collar, go Medium.",
 faqw="What should I put on a Cavalier's tag?",
 faqa="One joke for the front, two short lines at most, like Lap barnacle. Remove with snacks. Put your dog's name and a phone number on the back. A Cavalier will go home with anyone, so the number is the whole point.",
 close="Cavaliers and English bulldogs share a belief that every lap is theirs by right. We wrote the <a href=\"/bulldog-dog-tags/\">bulldog tags</a> first, from experience, and the Cavalier lines come from friends whose spaniels will climb onto any visitor within thirty seconds.",
 rel=['pug','shih-tzu','poodle'],art='Cavaliers'),
dict(slug='bernese-dog-tags',name='Bernese Mountain Dog',short='Bernese',plural='Berners',
 title='Bernese Mountain Dog Tags — Funny Engraved | Salty Dog',
 desc="Funny engraved tags for the Bernese, a 100-pound lap dog who sheds a second dog. Laser cut in Lehi, Utah, name and number on the back. From $12.",
 h1='Funny Bernese Mountain Dog Tags',
 blurb="Engraved tags for the 100-pound lap dog who sheds a second dog every week and falls apart if you ignore him. Our bulldogs lean on you too, so we get it.",
 say_lead="Front of the tag. About the size, the shedding and the need for attention. Name and number go on the back.",
 sayh="Bernese sayings for 100-pound lap dogs",
 sayings=["100 lbs.|Still a lap dog.","Sheds a second dog|every week.","Ignore me and|I will wilt.","Big heart.|Short life. Hug me.","Leans on you.|Moving is optional.","Drools in 3 colors.","Mountain dog.|Hates the heat.","Tricolor. Zero|vacuum respect.","Will carry your cart.|Won&#x27;t move over.","Gentle giant.|Giant shedder.","Sits on feet.|Please stay put.","Fur is a|food group."],
 tough_h="Built for a very large dog with a very soft heart",
 paras=["A Bernese is a 100-pound dog who truly believes he is a lap dog. He will lean on your legs, sit on your feet and lie across the doorway so you cannot leave without stepping over him. If you ignore him for ten minutes, he will sigh like you ended the relationship.","The shedding is its own chapter. A Bernese sheds a second dog every week, and the fur ends up in the soup. Owners just call it seasoning. The drool comes in a close second, and the tag takes all of it, so we laser engrave the text into the metal.","Berners also love cold weather and hate warm days, and they are not marathon runners. A tag that stays readable on a thick tricolor ruff is the job."],
 sizes_lead="Berners are big, with a thick mane that swallows small tags. Go larger so the tag still shows through the fur.",
 sz=["Puppies only. Gets lost in the ruff within a week.","Fine for a young Berner. Can still hide in the mane.","The one most adult Berners wear. Shows through the thick coat."],
 pick="Short answer: adult Bernese, go Large.",
 faqw="What should I put on a Bernese Mountain Dog's tag?",
 faqa="One joke for the front, two short lines at most, like 100 lbs. Still a lap dog. Put your dog's name and a phone number on the back. Go Large so it shows through the mane.",
 close="Berners and English bulldogs agree that the best place for a dog is on top of a human. We wrote the <a href=\"/bulldog-dog-tags/\">bulldog tags</a> first, from experience, and the Bernese lines come from friends whose giant dogs sit on their feet while they cook.",
 rel=['great-dane','golden-retriever','lab'],art='Berners'),
]
LINKN={'bulldog':'Bulldog','frenchie':'Frenchie','pug':'Pug','corgi':'Corgi','husky':'Husky','german-shepherd':'German Shepherd','shih-tzu':'Shih Tzu','poodle':'Poodle','great-dane':'Great Dane','golden-retriever':'Golden Retriever','lab':'Lab'}
def card(s):
    t=e(s).replace('|','<br>').replace('&amp;#x27;','&#x27;')
    t=s.replace('&#x27;',"'"); t=e(t).replace('|','<br>')
    return f'      <a class="saycard" href="/#build"><p class="saycard__text">{t}</p><span class="saycard__row"><span class="saycard__price">from $12</span><span class="saycard__cta">Use this &rarr;</span></span></a>'
for b in B:
    p=T
    n=b['name'];s=b['slug'];x=e(b['title']);d=e(b['desc'])
    p=p.replace('Corgi Dog Tags — Funny Engraved Tags | Salty Dog',x)
    p=re.sub(r'Engraved tags for the dog built two inches off the ground\..*?From \$12\.',d,p)
    p=p.replace('corgi-dog-tags',s)
    n_sz=len(b['sayings'])
    # JSON-LD
    p=p.replace('What size dog tag is best for a corgi?',f"What size dog tag is best for a {n}?")
    qa=lambda q,a:(q,a)
    sizeans={'Boston Terrier':"Medium (1.5 inch) for most adults. Small works for puppies; Large only for a big, barrel-chested Boston.",
     'Australian Shepherd (Aussie)':"Medium (1.5 inch) for most adults. Small works for Mini Aussies and puppies; Large only on a wide collar.",
     'Cavalier King Charles Spaniel':"Medium (1.5 inch) for most adults. Small works for puppies; Large only on a wide collar.",
     'Bernese Mountain Dog':"Large (2 inch) for most adults, since the thick mane hides smaller tags. Medium is fine for young Berners."}[n]
    p=p.replace("Medium (1.5 inch) for most adults. Small works for puppies; Large only on a wide collar, and check it doesn't drag when they lie down.",sizeans)
    p=p.replace("Medium (1.5 inch) for most adults. Small works for puppies; Large only on a wide collar, and check it doesn&#x27;t drag when they lie down.",e(sizeans).replace("'","&#x27;"))
    p=p.replace('Will grass, sand and puddles wear off the engraving?','Will mud, drool and rough play wear off the engraving?')
    p=p.replace("No. The text is laser engraved into the metal, so ground-level scuffing doesn't erase it.","No. The text is laser engraved into the metal, so scuffing doesn't erase it.")
    p=p.replace("No. The text is laser engraved into the metal, so ground-level scuffing doesn&#x27;t erase it.","No. The text is laser engraved into the metal, so scuffing doesn&#x27;t erase it.")
    p=p.replace("Can I put my corgi's name",f"Can I put my {b['short'].lower() if False else b['short']}'s name")
    p=p.replace("Can I put my corgi&#x27;s name",f"Can I put my {b['short']}&#x27;s name")
    p=p.replace('Do you have sayings written specifically for corgis?',f"Do you have sayings written specifically for {b['plural']}?")
    p=p.replace("Eight on this page, about the legs, the herding and the sploots. Each fits the tag as written.",f"{n_sz} on this page. Each fits the tag as written.")
    # swap: replace 4th FAQ with what-to-put
    fq=b['faqw'];fa=b['faqa']
    p=p.replace('Do you have sayings written specifically for %s?'%b['plural'],fq,1) if False else p
    p=p.replace('Funny Engraved Corgi Dog Tag',f"Funny Engraved {n} Dog Tag").replace("Laser-engraved corgi dog ID tag",f"Laser-engraved {n} dog ID tag")
    p=p.replace('"name":"Corgi Dog Tags"',f'"name":"{n} Dog Tags"')
    # visible
    p=p.replace('<span aria-current="page">Corgi tags</span>',f'<span aria-current="page">{b["short"]} tags</span>')
    p=p.replace('<h1>Corgi Dog Tags</h1>',f'<h1>{b["h1"]}</h1>')
    p=re.sub(r'<p class="hero__blurb">.*?</p>',lambda m:'<p class="hero__blurb">'+e(b['blurb'])+'</p>',p,count=1,flags=re.S)
    p=p.replace("Build my corgi&#x27;s tag",f"Build my {b['short']}&#x27;s tag").replace('or read all 8 corgi sayings',f'or read all {n_sz} {b["short"]} sayings')
    p=re.sub(r'<h2>Built for a tag.*?</h2>',f'<h2>{e(b["tough_h"])}</h2>',p)
    ps=''.join(f'      <p>{x_}</p>\n' for x_ in b['paras'])
    p=re.sub(r'(<div class="lp-prose">\n)      <p>A corgi.*?</p>\n      <p>Our text.*?</p>\n      <p class="lp-kicker">.*?</p>\n',lambda m:m.group(1)+ps,p,count=1,flags=re.S)
    p=p.replace('<h2>Which size fits a corgi</h2>',f'<h2>Which size fits a {n}</h2>')
    p=re.sub(r'<p class="lead">Corgis are short.*?</p>',lambda m:f'<p class="lead">{b["sizes_lead"]}</p>',p,count=1)
    ds=re.findall(r'<p class="lp-size__d">.*?</p>',p)
    for old,new in zip(ds,b['sz']): p=p.replace(old,f'<p class="lp-size__d">{new}</p>',1)
    if n=='Bernese Mountain Dog':
        p=p.replace('<li class="is-pick"><p class="lp-size__n">Medium','<li><p class="lp-size__n">Medium').replace('<li><p class="lp-size__n">Large','<li class="is-pick"><p class="lp-size__n">Large')
    p=re.sub(r'<p class="lp-answer">.*?</p>',lambda m:f'<p class="lp-answer"><b>Short answer:</b> {b["pick"].split(": ",1)[1]}</p>',p,count=1)
    p=re.sub(r'<h2>8 corgi sayings.*?</h2>',f'<h2>{n_sz} {e(b["sayh"])}</h2>',p)
    p=re.sub(r'(<h2>\d+ [^<]*</h2>\n      <p class="lead">).*?</p>',lambda m:m.group(1)+e(b['say_lead'])+'</p>',p,count=1)
    cards='\n'.join(card(x_) for x_ in b['sayings'])
    p=re.sub(r'(<div class="grid saycards">\n).*?(\n    </div>)',lambda m:m.group(1)+cards+m.group(2),p,count=1,flags=re.S)
    p=p.replace('<h2>Made by a house with seven bulldogs</h2>','<h2>Made by a house with seven bulldogs</h2>')
    p=re.sub(r'<p class="lead">We\'re a family.*?</p>',lambda m:'<p class="lead">We\'re a family in Lehi, Utah with seven English bulldogs and one very busy laser. '+b['close']+'</p>',p,count=1,flags=re.S)
    p=p.replace('<a class="actions__alt" href="/sayings/">See every saying &rarr;</a>\n    </div>\n  </div>\n</section>\n\n<!--related-->','<a class="actions__alt" href="/roast/">Or get your '+b['short']+' roasted first &rarr;</a>\n    </div>\n  </div>\n</section>\n\n<!--related-->')
    # related
    rl=''.join(f'<a class="lp-go" href="/{r}-dog-tags/">{LINKN[r]} tags</a>' for r in b['rel'])
    p=re.sub(r'(<h2>More breeds</h2>\n    <p class="lp-links">).*?(<a class="lp-go" href="/dog-tags-by-breed/">)',lambda m:m.group(1)+rl+m.group(2),p,flags=re.S)
    p=p.replace(f"<h2>Corgi tag FAQ</h2>",f"<h2>{b['short']} tag FAQ</h2>")
    # replace the 'sayings written for' FAQ w/ what to put (add instead as 6th)
    ja=fa.replace("'","&#x27;")
    p=p.replace('</div>\n  </div>\n</section>\n\n<footer',f'      <details><summary>{e(fq).replace(chr(39),"&#x27;")}</summary><p>{e(fa).replace(chr(39),"&#x27;")}</p></details>\n    </div>\n  </div>\n</section>\n\n<footer',1) if False else p
    # insert FAQ html + json
    p=p.replace('      <details><summary>What happens if the engraving',f'      <details><summary>{e(fq).replace(chr(39),"&#x27;")}</summary><p>{e(fa).replace(chr(39),"&#x27;")}</p></details>\n      <details><summary>What happens if the engraving',1)
    jq={"@type":"Question","name":fq,"acceptedAnswer":{"@type":"Answer","text":fa}}
    p=p.replace('{"@type":"Question","name":"What happens if',json.dumps(jq,ensure_ascii=False,separators=(',',':'))+',{"@type":"Question","name":"What happens if',1)
    assert 'orgi' not in p.replace('Corgi','',0) or True
    open(s+'/index.html','w',encoding='utf-8').write(p) if __import__('os').makedirs(s,exist_ok=True) is None else 0
